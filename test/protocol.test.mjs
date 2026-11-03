import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RELAY,
  SseParser,
  cardTitle,
  createEnvelope,
  decodeInvite,
  encodeInvite,
  excerpt,
  foldProject,
  issueIdFor,
  looksLikeFeedback,
  mergeVerdict,
  nextStatus,
  nextSeq,
  normalizeImage,
  parseEnvelope,
  serializeEnvelope,
  textSimilarity,
  titleKey,
  triage,
} from '../protocol.js';

test('triage: 中文缺陷描述命中 bug', () => {
  const verdict = triage('这里报错了，点保存没反应，能稳定复现');
  assert.equal(verdict.hit, true);
  assert.equal(verdict.type, 'bug');
  assert.ok(verdict.score >= 2);
  assert.match(verdict.title, /报错/);
});

test('triage: 体验吐槽命中 experience', () => {
  const verdict = triage('这个入口有点难用，找不到在哪里设置');
  assert.equal(verdict.hit, true);
  assert.equal(verdict.type, 'experience');
});

test('triage: 寒暄与空文本不命中', () => {
  assert.equal(triage('收到').hit, false);
  assert.equal(triage('好的').hit, false);
  assert.equal(triage('').hit, false);
  assert.equal(triage('今天聊什么').hit, false);
  assert.equal(triage('哈哈哈哈哈').hit, false);
});

test('triage: 英文缺陷描述命中', () => {
  const verdict = triage('the save button crashed, throws an exception every time');
  assert.equal(verdict.hit, true);
  assert.equal(verdict.type, 'bug');
});

test('cardTitle 取首句并截断', () => {
  const title = cardTitle('这里报错了。点了三次都一样。', 'bug');
  assert.equal(title, '这里报错了');
  const long = cardTitle('a'.repeat(200), 'bug');
  assert.ok(long.length <= 80);
});

test('excerpt 压成单行', () => {
  assert.equal(excerpt('a\nb\n  c', 20), 'a b c');
  assert.equal(excerpt('abc', 3), 'abc');
});

test('邀请码往返，且拒绝伪造/损坏的码', () => {
  const code = encodeInvite({
    relay: 'https://ntfy.sh',
    topic: 'dshproj-0123456789abcdef',
    projectId: 'p-1',
    name: '支付可靠性',
    inviter: '小马哥',
    repoPath: '/tmp/repo',
  });
  assert.ok(code.startsWith('DSHPROJ1:'));
  const invite = decodeInvite('看看这个 ' + code + ' 谢谢');
  assert.deepEqual(invite && invite.projectId, 'p-1');
  assert.equal(invite && invite.relay, 'https://ntfy.sh');
  assert.equal(invite && invite.name, '支付可靠性');
  assert.equal(decodeInvite('DSHPROJ1:not-json'), null);
  assert.equal(decodeInvite('DSHCHAT2:xxx'), null);
  assert.equal(decodeInvite(''), null);
});

test('信封往返与长度上限', () => {
  const envelope = createEnvelope({
    project: { id: 'p-1', name: '项目' },
    actor: { id: 'a-1', name: '小马哥', kind: 'human' },
    event: { id: 'e-1', at: 1234, type: 'message', data: { text: '你好', replyTo: '' } },
  });
  const body = serializeEnvelope(envelope);
  assert.ok(body);
  const parsed = parseEnvelope(body);
  assert.equal(parsed.project.id, 'p-1');
  assert.equal(parsed.event.type, 'message');
  assert.equal(parsed.event.data.text, '你好');
  assert.equal(parseEnvelope('not json'), null);
  assert.equal(parseEnvelope(JSON.stringify({ v: 99 })), null);
  const huge = createEnvelope({
    project: { id: 'p-1', name: '项目' },
    actor: { id: 'a-1', name: '小马哥', kind: 'human' },
    event: { id: 'e-2', at: 1, type: 'message', data: { text: '错'.repeat(1500) } },
  });
  assert.equal(serializeEnvelope(huge), null);
});

test('信封丢弃越权字段（只看允许的 patch）', () => {
  const envelope = createEnvelope({
    project: { id: 'p-1', name: '项目' },
    actor: { id: 'a-1', name: '小马哥', kind: 'human' },
    event: {
      id: 'e-3',
      at: 1,
      type: 'issue.updated',
      data: { issueId: 'is_1', patch: { status: 'done', worker: { sessionId: 's', status: 'running' }, evil: true } },
    },
  });
  const parsed = parseEnvelope(serializeEnvelope(envelope));
  assert.equal(parsed.event.data.issueId, 'is_1');
  assert.equal(parsed.event.data.patch.status, 'done');
  assert.equal(parsed.event.data.patch.evil, undefined);
});

test('信封往返：项目重命名事件只带 name', () => {
  const envelope = createEnvelope({
    project: { id: 'p-1', name: '旧名字' },
    actor: { id: 'a-1', name: '小马哥', kind: 'human' },
    event: { id: 'e-4', at: 1, type: 'project.renamed', data: { name: '  新 名字  ', evil: true } },
  });
  const parsed = parseEnvelope(serializeEnvelope(envelope));
  assert.equal(parsed.event.type, 'project.renamed');
  assert.equal(parsed.event.data.name, '新 名字');
  assert.equal(parsed.event.data.evil, undefined);
  // 空名字的改名事件没有意义，直接丢弃。
  const empty = createEnvelope({
    project: { id: 'p-1', name: '项目' },
    actor: { id: 'a-1', name: '小马哥', kind: 'human' },
    event: { id: 'e-5', at: 1, type: 'project.renamed', data: { name: '   ' } },
  });
  assert.equal(parseEnvelope(serializeEnvelope(empty)), null);
});

test('foldProject 折叠成员、消息、卡片与引用预览', () => {
  const base = { seq: 0, at: 1000 };
  const events = [
    { ...base, id: 'm1', seq: 1, type: 'message', actor: { id: 'u1', name: '小马哥', kind: 'human' }, data: { text: '登录页点登录没反应，报错了', replyTo: '' } },
    { ...base, id: 'c1', seq: 2, type: 'issue.created', actor: { id: 'agent', name: '项目助手', kind: 'agent' }, data: { issue: {
      id: 'is_1', type: 'bug', title: '登录页点登录没反应', detail: '登录页点登录没反应，报错了', status: 'open',
      createdAt: 1000, updatedAt: 1000, sourceEventId: 'm1', sourceActorName: '小马哥', auto: true,
    } } },
    { ...base, id: 'm2', seq: 3, at: 2000, type: 'message', actor: { id: 'u2', name: '阿蓝', kind: 'human' }, data: { text: '我这边也能复现', replyTo: 'm1' } },
    { ...base, id: 'c2', seq: 4, at: 3000, type: 'issue.updated', actor: { id: 'agent', name: '项目助手', kind: 'agent' }, data: { issueId: 'is_1', patch: { status: 'review' } } },
    { ...base, id: 'n1', seq: 5, at: 4000, type: 'notice', actor: { id: 'agent', name: '项目助手', kind: 'agent' }, data: { text: '修复完成，待验收', issueId: 'is_1' } },
  ];
  const folded = foldProject(events);
  assert.equal(folded.members.length, 2);
  assert.equal(folded.messages.length, 3);
  assert.equal(folded.messages[1].replyPreview, '登录页点登录没反应，报错了');
  assert.equal(folded.messages[2].kind, 'notice');
  assert.equal(folded.issues.length, 1);
  assert.equal(folded.issues[0].status, 'review');
  assert.deepEqual(folded.counts, { triage: 0, open: 0, fixing: 0, review: 1, done: 0, dismissed: 0 });
});

test('foldProject 忽略孤儿 patch 与非法卡片', () => {
  const folded = foldProject([
    { id: 'x', seq: 1, at: 1, type: 'issue.updated', actor: { id: 'a', name: 'a', kind: 'human' }, data: { issueId: 'nope', patch: { status: 'done' } } },
  ]);
  assert.equal(folded.issues.length, 0);
});

test('nextStatus 只允许合法流转', () => {
  assert.equal(nextStatus('triage', 'confirm'), 'open');
  assert.equal(nextStatus('triage', 'fix'), 'fixing');
  assert.equal(nextStatus('open', 'fix'), 'fixing');
  assert.equal(nextStatus('review', 'fix'), 'fixing');
  assert.equal(nextStatus('review', 'done'), 'done');
  assert.equal(nextStatus('review', 'reopen'), 'open');
  assert.equal(nextStatus('done', 'reopen'), 'open');
  assert.equal(nextStatus('dismissed', 'reopen'), 'open');
  assert.equal(nextStatus('open', 'confirm'), null);
  assert.equal(nextStatus('fixing', 'fix'), null);
  assert.equal(nextStatus('done', 'dismiss'), 'dismissed');
});

test('issueIdFor 对同一来源稳定、对不同来源不同', () => {
  const a = issueIdFor('p-1', 'e-1', 'bug');
  const b = issueIdFor('p-1', 'e-1', 'bug');
  const c = issueIdFor('p-1', 'e-2', 'bug');
  const d = issueIdFor('p-1', 'e-1', 'experience');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.match(a, /^is_[0-9a-f]{8}$/);
});

test('nextSeq 递增', () => {
  assert.equal(nextSeq([]), 1);
  assert.equal(nextSeq([{ seq: 3 }, { seq: 7 }, {}]), 8);
});

test('SseParser 处理分片与多事件', () => {
  const parser = new SseParser();
  assert.deepEqual(parser.push('event: open\ndata: {}'), []);
  const first = parser.push('\n\n');
  assert.equal(first.length, 1);
  assert.equal(first[0].event, 'open');
  const events = parser.push('event: message\ndata: {"id":"1"}\n\nid: 2\n');
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'message');
  assert.equal(events[0].data, '{"id":"1"}');
  assert.equal(DEFAULT_RELAY, 'https://ntfy.sh');
});

test('titleKey 归并同一问题的不同表述', () => {
  assert.equal(titleKey('登录页没反应'), titleKey('登录页没反应！'));
  assert.equal(titleKey('登录页 没反应'), titleKey('登录页没反应'));
  assert.notEqual(titleKey('登录页没反应'), titleKey('支付页没反应'));
});

test('triage: 只给复现步骤也算缺陷', () => {
  const verdict = triage('支付金额不对，能稳定复现，步骤：先下单再刷新');
  assert.equal(verdict.hit, true);
  assert.equal(verdict.type, 'bug');
});

test('textSimilarity 能识别同一问题的重复表述', () => {
  const a = '待办副标题太长了，“想到什么就写下来，回车保存”，感觉第二句可以删掉';
  const b = '发现一个体验不好的问题，待办副标题太长了，“想到什么就写下来，回车保存”，感觉第二句可以删掉';
  assert.ok(textSimilarity(a, b) >= 0.6);
  assert.ok(textSimilarity(a, '明天去哪吃呢') < 0.2);
});

test('looksLikeFeedback 放过闲聊、纳入带引用的意见', () => {
  assert.equal(looksLikeFeedback('明天去哪吃呢'), false);
  assert.equal(looksLikeFeedback('收到'), false);
  assert.equal(looksLikeFeedback('待办副标题太长了，感觉第二句可以删掉'), true);
  assert.equal(looksLikeFeedback('「保存」这个词改成「提交」'), true);
});

test('mergeVerdict 采用语义判定但保留规则标题', () => {
  const base = { hit: false, type: 'experience', score: 0, title: '', detail: '', reasons: [] };
  const merged = mergeVerdict(base, { hit: true, type: 'bug', title: '保存后金额不刷新' });
  assert.equal(merged.hit, true);
  assert.equal(merged.type, 'bug');
  assert.equal(merged.title, '保存后金额不刷新');
  assert.equal(mergeVerdict(base, { hit: false }).hit, false);
});

test('normalizeImage 只接受受支持的图片类型', () => {
  assert.deepEqual(normalizeImage({ name: 'a.png', type: 'image/png', size: 12 }), {
    name: 'a.png',
    type: 'image/png',
    size: 12,
  });
  assert.equal(normalizeImage({ type: 'image/svg+xml' }), null);
  assert.equal(normalizeImage({ type: 'text/plain' }), null);
  assert.equal(normalizeImage(null), null);
});

test('信封往返：带图片的消息允许空文本', () => {
  const envelope = createEnvelope({
    project: { id: 'p1', name: '项目' },
    actor: { id: 'a1', name: '我', kind: 'human' },
    event: {
      id: 'e1',
      at: Date.now(),
      type: 'message',
      data: { text: '', image: { name: 'shot.png', type: 'image/png', size: 1024 } },
    },
  });
  const body = serializeEnvelope(envelope);
  assert.ok(body);
  const parsed = parseEnvelope(body);
  assert.deepEqual(parsed.event.data.image, { name: 'shot.png', type: 'image/png', size: 1024 });
  assert.equal(parsed.event.data.text, '');
});

test('空文本且无图片的消息被拒绝', () => {
  const envelope = createEnvelope({
    project: { id: 'p1', name: '项目' },
    actor: { id: 'a1', name: '我', kind: 'human' },
    event: { id: 'e1', at: Date.now(), type: 'message', data: { text: '' } },
  });
  assert.ok(serializeEnvelope(envelope));
  assert.equal(parseEnvelope(JSON.stringify(envelope)), null);
});

test('foldProject 保留图片消息并以图片作为引用预览', () => {
  const at = Date.now();
  const folded = foldProject([
    {
      id: 'e1',
      at,
      type: 'message',
      actor: { id: 'a1', name: '我', kind: 'human' },
      data: { text: '', image: { name: 'shot.png', type: 'image/png', size: 1024 } },
    },
    {
      id: 'e2',
      at: at + 1,
      type: 'message',
      actor: { id: 'a2', name: '同事', kind: 'human' },
      data: { text: '这张截图里的按钮没对齐', replyTo: 'e1' },
    },
  ]);
  assert.equal(folded.messages.length, 2);
  assert.deepEqual(folded.messages[0].image, { name: 'shot.png', type: 'image/png', size: 1024 });
  assert.equal(folded.messages[1].replyPreview, '图片');
});

test('信封往返：重新打开说明随 issue.updated 同步，越权字段仍被丢弃', () => {
  const envelope = createEnvelope({
    project: { id: 'p-1', name: '项目' },
    actor: { id: 'a-1', name: 'Victor', kind: 'human' },
    event: {
      id: 'e-6',
      at: 1,
      type: 'issue.updated',
      data: { issueId: 'is_1', patch: { status: 'open', feedback: '按钮间距再调一下', evil: true } },
    },
  });
  const parsed = parseEnvelope(serializeEnvelope(envelope));
  assert.equal(parsed.event.data.patch.status, 'open');
  assert.equal(parsed.event.data.patch.feedback, '按钮间距再调一下');
  assert.equal(parsed.event.data.patch.evil, undefined);
});

test('foldProject 应用重新打开说明，空字符串清空上一轮说明', () => {
  const actor = { id: 'a1', name: 'Victor', kind: 'human' };
  const issue = {
    id: 'is_1',
    type: 'experience',
    title: '按钮位置有点偏',
    detail: '导出按钮位置有点偏，希望和右边对齐',
    status: 'review',
    createdAt: 1,
    updatedAt: 1,
    sourceEventId: 'm1',
    sourceActorName: 'Victor',
    auto: false,
  };
  const events = [
    { id: 'c1', seq: 1, at: 1, type: 'issue.created', actor, data: { issue } },
    {
      id: 'u1',
      seq: 2,
      at: 2,
      type: 'issue.updated',
      actor,
      data: { issueId: 'is_1', patch: { status: 'open', feedback: '这次只调间距', updatedAt: 2 } },
    },
    {
      id: 'u2',
      seq: 3,
      at: 3,
      type: 'issue.updated',
      actor,
      data: { issueId: 'is_1', patch: { status: 'open', feedback: '', updatedAt: 3 } },
    },
  ];
  const withNote = foldProject(events.slice(0, 2));
  assert.equal(withNote.issues[0].status, 'open');
  assert.equal(withNote.issues[0].feedback, '这次只调间距');
  const cleared = foldProject(events);
  assert.equal(cleared.issues[0].feedback, '');
});
