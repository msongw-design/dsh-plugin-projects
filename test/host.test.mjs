import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { ProjectsHost } from '../index.js';

/**
 * A tiny in-process stand-in for the public relay: POST /<topic> stores one
 * message, PUT /<topic>?message= stores a message plus an attachment, GET
 * /<topic>/sse streams stored and future messages, and GET /file/<id> serves
 * attachment bytes. It mirrors the parts of ntfy the plugin depends on, so the
 * bridge, dedupe and publish paths are exercised without a network.
 */
async function startFakeRelay() {
  const messages = new Map();
  const streams = new Map();
  const files = new Map();
  let seq = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname.startsWith('/file/')) {
      const stored = files.get(url.pathname.slice('/file/'.length));
      if (!stored) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': stored.type, 'Content-Length': stored.bytes.length });
      res.end(stored.bytes);
      return;
    }
    const topic = decodeURIComponent(url.pathname.split('/')[1] || '');
    const announce = (record) => {
      for (const subscriber of streams.get(topic) || []) {
        // Teardown may end a stream while a late publish is still in flight.
        if (subscriber.writableEnded) continue;
        subscriber.write(
          'event: message\ndata: ' +
            JSON.stringify({
              id: record.id,
              event: 'message',
              message: record.message,
              attachment: record.attachment,
            }) +
            '\n\n',
        );
      }
    };
    const store = (record) => {
      if (!messages.has(topic)) messages.set(topic, []);
      messages.get(topic).push(record);
      announce(record);
    };
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const record = { id: String(++seq), message: body };
        store(record);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: record.id }));
      });
      return;
    }
    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const id = String(++seq);
        const bytes = Buffer.concat(chunks);
        const type = (req.headers['content-type'] || '').split(';')[0].trim();
        files.set(id, { bytes, type });
        const port = server.address().port;
        const record = {
          id,
          message: url.searchParams.get('message') || '',
          attachment: {
            name: req.headers.filename || 'image',
            type,
            size: bytes.length,
            url: 'http://127.0.0.1:' + port + '/file/' + id,
          },
        };
        store(record);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: record.id }));
      });
      return;
    }
    if (req.method === 'GET' && url.pathname.endsWith('/sse')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      res.write('event: open\ndata: {}\n\n');
      for (const record of messages.get(topic) || []) {
        res.write(
          'event: message\ndata: ' +
            JSON.stringify({
              id: record.id,
              event: 'message',
              message: record.message,
              attachment: record.attachment,
            }) +
            '\n\n',
        );
      }
      if (!streams.has(topic)) streams.set(topic, []);
      streams.get(topic).push(res);
      req.on('close', () => {
        const list = streams.get(topic) || [];
        const index = list.indexOf(res);
        if (index >= 0) list.splice(index, 1);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: 'http://127.0.0.1:' + port,
    close: () =>
      new Promise((resolve) => {
        for (const list of streams.values()) for (const res of list) res.end();
        server.close(() => resolve());
      }),
  };
}

function makeHost(relayUrl, dataDir) {
  const ctx = {
    logger: { warn() {} },
    get() {
      return undefined;
    },
  };
  const webServer = { register() { return () => {}; } };
  const host = new ProjectsHost({ ctx, webServer, dataDir });
  // New projects inherit the default relay; point them at the in-process one so
  // the suite runs offline instead of against the public relay.
  host.loaded.relay = relayUrl;
  return host;
}

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'projects-' + name + '-'));
}

/** A request stand-in for calling the plugin's HTTP handler directly. */
function makeRequest({ method, url, headers, body }) {
  const req = new Readable({ read() {} });
  req.method = method;
  req.url = url;
  req.headers = headers || {};
  if (body) req.push(body);
  req.push(null);
  return req;
}

/** A response stand-in that records the status line, headers and body. */
function makeResponse() {
  const chunks = [];
  let status = 0;
  const headers = {};
  const res = {
    writeHead(value, head) {
      status = value;
      Object.assign(headers, head || {});
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
    },
    destroy() {},
  };
  return { res, result: () => ({ status, headers, body: Buffer.concat(chunks) }) };
}

async function waitFor(assertion, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 5000);
  let lastError;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  }
  throw lastError || new Error('timeout');
}

test('两个 DSH 通过中继同步讨论、卡片与成员', async () => {
  const relay = await startFakeRelay();
  const left = makeHost(relay.url, tmpDir('left'));
  const right = makeHost(relay.url, tmpDir('right'));
  try {
    left.start();
    right.start();
    left.saveSettings({ autoFix: false });
    const created = left.createProject({ name: '支付可靠性', repoPath: os.tmpdir() });
    assert.equal(created.ok, true);
    const projectId = created.state.projects[0].id;
    const invite = left.inviteCode(projectId);
    assert.equal(invite.ok, true);
    const joined = right.joinProject({ code: invite.code });
    assert.equal(joined.ok, true);

    await waitFor(() => {
      assert.equal(left.bridgeOf(projectId).status, 'online');
      assert.equal(right.bridgeOf(projectId).status, 'online');
    });

    // A member joins with the invite code; her presence reaches the inviter.
    await waitFor(() => {
      const members = left.snapshot().projects[0].members;
      assert.ok(members.length >= 2, 'expected join notice: ' + JSON.stringify(members));
    });

    // A normal chat message travels but opens no card.
    left.sendMessage(projectId, { text: '今天先把登录入口对齐一下' });
    await waitFor(() => {
      const messages = right.snapshot().projects[0].messages;
      assert.ok(messages.some((message) => message.text === '今天先把登录入口对齐一下'), JSON.stringify(messages));
    });
    assert.equal(right.snapshot().projects[0].issues.length, 0);

    // A defect report opens exactly one card on both sides.
    left.sendMessage(projectId, { text: '登录页点登录没反应，一直报错，能稳定复现' });
    await waitFor(() => {
      const issues = right.snapshot().projects[0].issues;
      assert.equal(issues.length, 1, JSON.stringify(issues));
    });
    const issue = right.snapshot().projects[0].issues[0];
    assert.equal(issue.type, 'bug');
    assert.equal(issue.status, 'triage');
    assert.equal(issue.sourceActorName, '我');
    assert.equal(issue.auto, true);
    assert.equal(left.snapshot().projects[0].issues[0].id, issue.id);

    // Reporting the same defect twice does not duplicate the card.
    left.sendMessage(projectId, { text: '登录页点登录没反应，一直报错，能稳定复现，再补一张截图' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(right.snapshot().projects[0].issues.length, 1);

    // A member confirms the card; the status reaches the other machine.
    const confirmed = right.applyIssueAction(projectId, issue.id, 'confirm');
    assert.equal(confirmed.ok, true);
    await waitFor(() => {
      assert.equal(left.snapshot().projects[0].issues[0].status, 'open');
    });

    // Dismissing from the other side converges too.
    left.applyIssueAction(projectId, issue.id, 'dismiss');
    await waitFor(() => {
      assert.equal(right.snapshot().projects[0].issues[0].status, 'dismissed');
    });
  } finally {
    left.dispose();
    right.dispose();
    await relay.close();
  }
});

test('重命名：本机立即生效、持久化并同步给成员，空名字被拒绝', async () => {
  const relay = await startFakeRelay();
  const left = makeHost(relay.url, tmpDir('rename-left'));
  const right = makeHost(relay.url, tmpDir('rename-right'));
  try {
    left.start();
    right.start();
    left.saveSettings({ autoFix: false });
    const created = left.createProject({ name: '旧名字', repoPath: os.tmpdir() });
    assert.equal(created.ok, true);
    const projectId = created.state.projects[0].id;
    assert.equal(right.joinProject({ code: left.inviteCode(projectId).code }).ok, true);
    await waitFor(() => {
      assert.equal(left.bridgeOf(projectId).status, 'online');
      assert.equal(right.bridgeOf(projectId).status, 'online');
    });

    // 本机 State 立即换名，并写进 state.json（重启后仍是新名字）。
    const renamed = left.renameProject({ projectId, name: '新名字' });
    assert.equal(renamed.ok, true);
    assert.equal(renamed.state.projects[0].name, '新名字');
    const saved = JSON.parse(fs.readFileSync(left.file, 'utf8'));
    assert.equal(saved.projects[0].name, '新名字');

    // 改名作为 project.renamed 事件发布，成员那边的显示名跟着变。
    await waitFor(() => {
      assert.equal(right.snapshot().projects[0].name, '新名字');
    });

    // 空名字与不存在的项目都要给出可读错误，且不改名。
    assert.equal(left.renameProject({ projectId, name: '   ' }).ok, false);
    assert.equal(left.renameProject({ projectId: 'nope', name: 'x' }).ok, false);
    assert.equal(left.snapshot().projects[0].name, '新名字');

    // HTTP 路由同样可用。
    const http = makeResponse();
    await left.handleHttp(
      makeRequest({
        method: 'POST',
        url: '/plugin/projects/rename',
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({ projectId, name: '再改一次' })),
      }),
      http.res,
    );
    assert.equal(http.result().status, 200);
    assert.equal(left.snapshot().projects[0].name, '再改一次');
  } finally {
    left.dispose();
    right.dispose();
    await relay.close();
  }
});

test('图片消息：本机落盘，经中继同步并在对端保存', async () => {
  const relay = await startFakeRelay();
  const left = makeHost(relay.url, tmpDir('image-left'));
  const right = makeHost(relay.url, tmpDir('image-right'));
  try {
    left.start();
    right.start();
    left.saveSettings({ autoFix: false });
    const created = left.createProject({ name: '截图讨论', repoPath: os.tmpdir() });
    assert.equal(created.ok, true);
    const projectId = created.state.projects[0].id;
    assert.equal(right.joinProject({ code: left.inviteCode(projectId).code }).ok, true);
    await waitFor(() => {
      assert.equal(left.bridgeOf(projectId).status, 'online');
      assert.equal(right.bridgeOf(projectId).status, 'online');
    });

    // A 1x1 PNG is enough to prove the bytes make the round trip.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const sent = left.sendImage(projectId, png, { type: 'image/png', name: '截图.png' });
    assert.equal(sent.ok, true);
    const local = left.snapshot().projects[0].messages.find((message) => message.image);
    assert.ok(local, 'local picture message missing');
    assert.equal(local.image.ready, true);
    assert.equal(local.image.name, '截图.png');
    assert.equal(local.text, '');

    await waitFor(() => {
      const remote = right.snapshot().projects[0].messages.find((message) => message.image);
      assert.ok(
        remote && remote.image.ready,
        'remote picture not stored: ' + JSON.stringify(right.snapshot().projects[0].messages),
      );
    });
    const remote = right.snapshot().projects[0].messages.find((message) => message.image);
    assert.equal(remote.id, local.id);
    assert.equal(remote.image.type, 'image/png');
    assert.deepEqual(fs.readFileSync(right.imageFile(remote.id, 'image/png')), png);
    // A picture is a message, not feedback: it opens no card.
    assert.equal(right.snapshot().projects[0].issues.length, 0);

    // Unsupported types and oversized pictures are refused before anything lands.
    assert.equal(left.sendImage(projectId, Buffer.from('x'), { type: 'text/plain' }).ok, false);
    assert.equal(
      left.sendImage(projectId, Buffer.alloc(4 * 1024 * 1024 + 1), { type: 'image/png' }).ok,
      false,
    );
  } finally {
    left.dispose();
    right.dispose();
    await relay.close();
  }
});

test('HTTP /image：上传落盘并从同源读回', async () => {
  const relay = await startFakeRelay();
  const host = makeHost(relay.url, tmpDir('image-http'));
  try {
    host.start();
    const created = host.createProject({ name: '截图接口', repoPath: os.tmpdir() });
    const projectId = created.state.projects[0].id;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    const uploaded = makeResponse();
    await host.handleHttp(
      makeRequest({
        method: 'POST',
        url: '/plugin/projects/image?id=' + projectId + '&name=shot.png',
        headers: { 'content-type': 'image/png' },
        body: png,
      }),
      uploaded.res,
    );
    const uploadResult = uploaded.result();
    assert.equal(uploadResult.status, 200);
    const payload = JSON.parse(uploadResult.body.toString('utf8'));
    assert.equal(payload.ok, true);
    const message = payload.state.projects[0].messages.find((entry) => entry.image);
    assert.ok(message, 'picture message missing from the returned state');
    assert.equal(message.image.ready, true);

    const read = makeResponse();
    await host.handleHttp(
      makeRequest({ method: 'GET', url: '/plugin/projects/image?id=' + message.id }),
      read.res,
    );
    const readResult = read.result();
    assert.equal(readResult.status, 200);
    assert.equal(readResult.headers['Content-Type'], 'image/png');
    assert.deepEqual(readResult.body, png);

    // A missing picture and an unsupported type are readable errors.
    const missing = makeResponse();
    await host.handleHttp(
      makeRequest({ method: 'GET', url: '/plugin/projects/image?id=nope' }),
      missing.res,
    );
    assert.equal(missing.result().status, 404);
    const badType = makeResponse();
    await host.handleHttp(
      makeRequest({
        method: 'POST',
        url: '/plugin/projects/image?id=' + projectId,
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from('not a picture'),
      }),
      badType.res,
    );
    assert.equal(badType.result().status, 400);
  } finally {
    host.dispose();
    await relay.close();
  }
});

test('State 暴露 capabilities：Client 据此判断 Host 是否已加载图片通路与重新打开说明', async () => {
  const relay = await startFakeRelay();
  const host = makeHost(relay.url, tmpDir('capabilities'));
  try {
    host.start();
    host.createProject({ name: '能力位', repoPath: os.tmpdir() });
    assert.deepEqual(host.snapshot().capabilities, { image: true, reopenNote: true });

    const read = makeResponse();
    await host.handleHttp(makeRequest({ method: 'GET', url: '/plugin/projects/state' }), read.res);
    const body = JSON.parse(read.result().body.toString('utf8'));
    // 旧 Host 的 State 里没有 capabilities；Client 必须把它当成「图片通路不可用」，
    // 提示重启，而不是把字节发给一个没有 /image 路由的 Host。
    // 同理，旧 Host 会丢弃 reopen 的 note，Client 也不能提交非空说明。
    assert.deepEqual(body.capabilities, { image: true, reopenNote: true });
  } finally {
    host.dispose();
    await relay.close();
  }
});

test('修复动作在没有 Agent 服务时回退为可读错误，不丢失卡片', async () => {
  const relay = await startFakeRelay();
  const host = makeHost(relay.url, tmpDir('solo'));
  try {
    host.start();
    const created = host.createProject({ name: '单机验证', repoPath: os.tmpdir() });
    const projectId = created.state.projects[0].id;
    host.sendMessage(projectId, { text: '导出按钮点了没反应，报错 cannot read properties' });
    await waitFor(() => {
      assert.equal(host.snapshot().projects[0].issues.length, 1);
    });
    const issue = host.snapshot().projects[0].issues[0];
    assert.equal(issue.status, 'open');
    const result = host.applyIssueAction(projectId, issue.id, 'fix');
    assert.equal(result.ok, true);
    await waitFor(() => {
      const current = host.snapshot().projects[0].issues[0];
      assert.equal(current.status, 'open');
      assert.ok(current.error, 'expected a readable error on the card');
      assert.match(current.error, /Agent/);
    });
    const notices = host.snapshot().projects[0].messages.filter((message) => message.kind === 'notice');
    assert.ok(notices.some((message) => /修复会话启动失败|失败/.test(message.text)));
  } finally {
    host.dispose();
    await relay.close();
  }
});

test('已有修复中问题时，另一张卡点「修复」给出可读提示且状态不变', async () => {
  const relay = await startFakeRelay();
  const host = makeHost(relay.url, tmpDir('busy'));
  try {
    host.start();
    host.saveSettings({ autoFix: false });
    const created = host.createProject({ name: '并发修复', repoPath: os.tmpdir() });
    const projectId = created.state.projects[0].id;
    host.sendMessage(projectId, { text: '导出按钮点了没反应，报错 cannot read properties' });
    host.sendMessage(projectId, { text: '登录页点登录没反应，一直报错，能稳定复现' });
    await waitFor(() => {
      assert.equal(host.snapshot().projects[0].issues.length, 2);
    });
    const [first, second] = host.snapshot().projects[0].issues;
    assert.equal(second.status, 'triage');

    // Keep the first Worker in flight, so the project stays busy.
    host.runWorker = () => new Promise(() => {});
    assert.equal(host.applyIssueAction(projectId, first.id, 'fix').ok, true);
    assert.equal(
      host.snapshot().projects[0].issues.find((issue) => issue.id === first.id).status,
      'fixing',
    );

    const blocked = host.applyIssueAction(projectId, second.id, 'fix');
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /已有修复中问题/);
    assert.equal(
      host.snapshot().projects[0].issues.find((issue) => issue.id === second.id).status,
      'triage',
    );

    // The Client reads this error from the same HTTP response the board uses.
    const read = makeResponse();
    await host.handleHttp(
      makeRequest({
        method: 'POST',
        url: '/plugin/projects/issue',
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({ projectId, issueId: second.id, action: 'fix' })),
      }),
      read.res,
    );
    assert.equal(read.result().status, 400);
    assert.match(JSON.parse(read.result().body.toString('utf8')).error, /已有修复中问题/);
  } finally {
    host.dispose();
    await relay.close();
  }
});

test('自动修复遇到已有修复中问题时，新卡片停在 open 并在讨论里说明原因', async () => {
  const relay = await startFakeRelay();
  const host = makeHost(relay.url, tmpDir('auto-busy'));
  try {
    host.start();
    host.saveSettings({ autoFix: true });
    const created = host.createProject({ name: '自动修复排队', repoPath: os.tmpdir() });
    const projectId = created.state.projects[0].id;
    // Keep the first Worker in flight, so the project stays busy.
    host.runWorker = () => new Promise(() => {});
    host.sendMessage(projectId, { text: '导出按钮点了没反应，报错 cannot read properties' });
    await waitFor(() => {
      assert.equal(host.snapshot().projects[0].issues.length, 1);
      assert.equal(host.snapshot().projects[0].issues[0].status, 'fixing');
    });

    host.sendMessage(projectId, { text: '登录页点登录没反应，一直报错，能稳定复现' });
    await waitFor(() => {
      assert.equal(host.snapshot().projects[0].issues.length, 2);
    });
    const queued = host.snapshot().projects[0].issues.find((issue) => issue.status === 'open');
    assert.ok(queued, 'expected the new card to stay open while the Worker is busy');
    const notices = host.snapshot().projects[0].messages.filter((message) => message.kind === 'notice');
    assert.ok(
      notices.some((message) => /已有修复中问题/.test(message.text)),
      JSON.stringify(notices),
    );
  } finally {
    host.dispose();
    await relay.close();
  }
});

test('重新打开可附一句说明：卡片回到待处理、讨论留痕、下一轮修复提示词带上说明', async () => {
  const relay = await startFakeRelay();
  const host = makeHost(relay.url, tmpDir('reopen-note'));
  try {
    host.start();
    host.saveSettings({ autoFix: false });
    const created = host.createProject({ name: '体验迭代', repoPath: os.tmpdir() });
    const projectId = created.state.projects[0].id;
    host.sendMessage(projectId, { text: '导出按钮有点难用，找不到在哪里设置' });
    await waitFor(() => {
      assert.equal(host.snapshot().projects[0].issues.length, 1);
    });
    const issue = host.snapshot().projects[0].issues[0];
    assert.equal(issue.status, 'triage');
    assert.equal(host.applyIssueAction(projectId, issue.id, 'confirm').ok, true);

    // First round: the Worker reports success and the card waits for review.
    host.runWorker = async () => ({
      ok: true,
      summary: '结论：已实现导出入口\n根因：入口缺失\n改动：client.js\n验证：node --test 通过',
    });
    assert.equal(host.applyIssueAction(projectId, issue.id, 'fix').ok, true);
    await waitFor(() => {
      assert.equal(host.snapshot().projects[0].issues[0].status, 'review');
    });

    // Reopen through the same HTTP route the panel uses, with one line of
    // guidance. The note is stored, shows up in the discussion, and reaches
    // the next Worker prompt instead of making it redo the same work.
    const note = '功能已经能用了，这次只想把按钮间距和右对齐再调一下';
    const reopenHttp = makeResponse();
    await host.handleHttp(
      makeRequest({
        method: 'POST',
        url: '/plugin/projects/issue',
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({ projectId, issueId: issue.id, action: 'reopen', note })),
      }),
      reopenHttp.res,
    );
    assert.equal(reopenHttp.result().status, 200);
    const reopened = host.snapshot().projects[0].issues[0];
    assert.equal(reopened.status, 'open');
    assert.equal(reopened.feedback, note);
    const notices = host.snapshot().projects[0].messages.filter((message) => message.kind === 'notice');
    assert.ok(
      notices.some((message) => message.text.includes(note)),
      JSON.stringify(notices),
    );

    let prompt = '';
    host.runWorker = async (project, current) => {
      prompt = host.workerPrompt(project, current);
      return { ok: true, summary: '结论：已按说明优化\n根因：间距与对齐\n改动：client.js\n验证：node --test 通过' };
    };
    assert.equal(host.applyIssueAction(projectId, issue.id, 'fix').ok, true);
    await waitFor(() => {
      assert.equal(host.snapshot().projects[0].issues[0].status, 'review');
    });
    assert.ok(prompt.includes('重新打开说明：' + note), prompt);

    // Reopening without a note clears the previous round's guidance.
    assert.equal(host.applyIssueAction(projectId, issue.id, 'reopen').ok, true);
    assert.equal(host.snapshot().projects[0].issues[0].status, 'open');
    assert.equal(host.snapshot().projects[0].issues[0].feedback, '');
    const cleared = host
      .snapshot()
      .projects[0].messages.filter((message) => message.kind === 'notice')
      .pop();
    assert.ok(cleared && !cleared.text.includes('补充说明'), JSON.stringify(cleared));
  } finally {
    host.dispose();
    await relay.close();
  }
});

test('无效输入被拒绝：空消息、坏邀请码、不存在的目录', async () => {
  const relay = await startFakeRelay();
  const host = makeHost(relay.url, tmpDir('reject'));
  try {
    host.start();
    const created = host.createProject({ name: '边界', repoPath: os.tmpdir() });
    const projectId = created.state.projects[0].id;
    assert.equal(host.sendMessage(projectId, { text: '   ' }).ok, false);
    assert.equal(host.sendMessage(projectId, { text: 'x'.repeat(3000) }).ok, false);
    assert.equal(host.joinProject({ code: 'DSHPROJ1:bad' }).ok, false);
    assert.equal(host.createProject({ name: '坏路径', repoPath: '/definitely/not/here' }).ok, false);
    assert.equal(host.createProject({ name: '', repoPath: os.tmpdir() }).ok, false);
    assert.equal(host.applyIssueAction(projectId, 'nope', 'fix').ok, false);
    assert.equal(host.setActive('nope').ok, false);
  } finally {
    host.dispose();
    await relay.close();
  }
});
