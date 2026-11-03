/**
 * 项目 — Host half.
 *
 * One project is one shared discussion plus one board of cards. Every member's
 * DSH joins the same relay topic, so the discussion is continuous across
 * machines, and each machine keeps its own append-only copy of the event log.
 * The panel (`client.js`) only renders a fold of that log.
 *
 * The part that makes the project more than a chat: every message that a member
 * posts here passes the deterministic Fast Path in `protocol.triage`. A hit
 * becomes a card; a high-confidence hit starts a Worker DSH session that
 * reproduces and fixes it in the project repository, then reports back into the
 * discussion. That is the "quietly reproduce and fix" loop from the Super-agent
 * design, scoped to a project channel.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_RELAY,
  IMAGE_TYPES,
  MAX_DETAIL,
  MAX_EVENTS,
  MAX_IMAGE_BYTES,
  MAX_NAME,
  MAX_TEXT,
  SseParser,
  clampText,
  createEnvelope,
  createTopic,
  decodeInvite,
  encodeInvite,
  excerpt,
  foldProject,
  isValidTopic,
  issueIdFor,
  looksLikeFeedback,
  mergeVerdict,
  nextSeq,
  nextStatus,
  normalizeImage,
  normalizeName,
  normalizeRelay,
  parseEnvelope,
  randomId,
  serializeEnvelope,
  textSimilarity,
  titleKey,
  triage,
} from './protocol.js';

export const inject = ['webServer'];

/** Same-origin API the Client panel talks to. */
const ROUTE_PREFIX = '/plugin/projects';

/** Projects one DSH keeps. */
const MAX_PROJECTS = 12;

/** Backoff bounds for a topic subscription, in milliseconds. */
const RECONNECT_BASE = 1500;
const RECONNECT_MAX = 20000;

/** How often an idle page stream gets a comment line, in milliseconds. */
const PAGE_KEEPALIVE = 25000;

/** Upper bound on a request body from the page. */
const MAX_BODY = 65536;

/** Persist debounce. */
const SAVE_DELAY = 400;

const DEFAULT_NICK = '我';

/** A Worker that hangs this long is reported as failed and left for a person. */
const FIX_TIMEOUT = 20 * 60 * 1000;

/** Scores at or above this open a fix automatically while `autoFix` is on. */
const HIGH_CONFIDENCE = 3.5;

export function apply(ctx) {
  const webServer = ctx.webServer;
  if (!webServer) return;
  ctx.effect(() => {
    const host = new ProjectsHost({ ctx, webServer, dataDir: resolveDataDir() });
    host.start();
    return () => host.dispose();
  }, 'projects-runtime');
}

/** Profile-scoped data directory: survives reloads and restarts. */
function resolveDataDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'plugin-data', 'projects');
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

function describeError(error) {
  if (!error) return '未知错误';
  if (error.name === 'TimeoutError') return '中继超时';
  if (error.name === 'AbortError') return '中继连接已关闭';
  const message = typeof error.message === 'string' ? error.message : String(error);
  const cause = error.cause && typeof error.cause.message === 'string' ? error.cause.message : '';
  return cause && cause !== message ? message + '（' + cause + '）' : message;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Reads a raw request body; gives up as soon as it passes the cap. */
function readBytes(req, limit) {
  return new Promise((resolve) => {
    let size = 0;
    let overflow = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (overflow) return;
      size += chunk.length;
      if (size > limit) {
        overflow = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(overflow ? null : Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

/** The file extension for a picture type. */
function imageExtension(type) {
  const known = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  return known[type] || 'bin';
}

/** The content type of a stored picture, judged by its file name. */
function imageTypeOf(file) {
  const name = String(file || '').toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

/**
 * The relay's Filename header must be Latin-1, so a non-ASCII display name
 * falls back to a plain file name. The display name still travels inside the
 * envelope's image description.
 */
function headerImageName(name, type) {
  const ascii = String(name || '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/["\\]/g, '')
    .trim();
  return ascii || 'image.' + imageExtension(type);
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch (err) {
    return false;
  }
}

function mkdirp(target) {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
}

/** Atomic-ish JSON write: write a sibling temp file, then rename over. */
function writeJson(file, value) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temp, file);
}

/** Publishes one envelope body to a relay topic. */
async function publishTo(relay, topic, body) {
  const response = await fetch(relay + '/' + encodeURIComponent(topic), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('中继返回 HTTP ' + response.status);
}

/**
 * Publishes a picture to a topic. The relay keeps the bytes as an attachment
 * and carries the envelope as the message text, so a picture travels the same
 * path a line of discussion does. The envelope goes in the query string
 * because it is small and may contain non-ASCII names.
 */
async function publishPicture(relay, topic, body, { bytes, name, type }) {
  const url = relay + '/' + encodeURIComponent(topic) + '?message=' + encodeURIComponent(body);
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Filename: headerImageName(name, type),
      'Content-Type': type,
    },
    body: bytes,
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error('中继返回 HTTP ' + response.status);
}

/* ------------------------------------------------------------------ *
 * One topic subscription
 * ------------------------------------------------------------------ */

/** Keeps one project's relay subscription alive with its own resume cursor. */
class TopicBridge {
  constructor({ relay, topic, projectId, cursor, onStatus, onEnvelope, onCursor }) {
    this.relay = relay;
    this.topic = topic;
    this.projectId = projectId;
    this.cursor = typeof cursor === 'string' ? cursor : '';
    this.onStatus = onStatus;
    this.onEnvelope = onEnvelope;
    this.onCursor = onCursor;
    this.active = false;
    this.attempt = 0;
    this.controller = null;
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.attempt = 0;
    this.onStatus('connecting', '');
    void this.loop();
  }

  stop() {
    this.active = false;
    if (this.controller) {
      try {
        this.controller.abort();
      } catch (err) {
        /* already aborted */
      }
      this.controller = null;
    }
  }

  async loop() {
    while (this.active) {
      try {
        await this.stream();
      } catch (error) {
        if (!this.active) break;
        this.onStatus('error', describeError(error));
      }
      if (!this.active) break;
      const wait = Math.min(RECONNECT_MAX, RECONNECT_BASE * 2 ** Math.min(this.attempt, 6));
      this.attempt += 1;
      await sleep(wait);
    }
  }

  async stream() {
    const controller = new AbortController();
    this.controller = controller;
    const since = this.cursor || 'all';
    const url =
      this.relay +
      '/' +
      encodeURIComponent(this.topic) +
      '/sse?since=' +
      encodeURIComponent(since);
    const response = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('中继返回 HTTP ' + response.status);
    if (!response.body) throw new Error('中继响应没有正文');
    this.attempt = 0;
    this.onStatus('online', '');
    const decoder = new TextDecoder();
    const parser = new SseParser();
    for await (const chunk of response.body) {
      if (!this.active) break;
      for (const event of parser.push(decoder.decode(chunk, { stream: true }))) {
        this.handleEvent(event);
      }
    }
    throw new Error('中继流已关闭');
  }

  handleEvent(event) {
    if (event.event === 'open') {
      this.onStatus('online', '');
      return;
    }
    if (event.event !== 'message') return;
    let frame;
    try {
      frame = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    if (!frame || typeof frame !== 'object') return;
    if (typeof frame.id === 'string' && frame.id) {
      this.cursor = frame.id;
      this.onCursor(frame.id);
    }
    if (frame.event !== 'message' || typeof frame.message !== 'string') return;
    const envelope = parseEnvelope(frame.message);
    if (!envelope) return;
    this.onEnvelope(envelope, frame.attachment);
  }
}

/* ------------------------------------------------------------------ *
 * Host
 * ------------------------------------------------------------------ */

export class ProjectsHost {
  constructor({ ctx, webServer, dataDir }) {
    this.ctx = ctx;
    this.webServer = webServer;
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'state.json');
    this.projectsDir = path.join(dataDir, 'projects');
    this.disposers = [];
    this.streams = new Set();
    this.bridges = new Map();
    this.bridgeStatus = new Map();
    this.seenIds = new Map();
    this.logs = new Map();
    this.working = new Map();
    this.semanticPending = new Set();
    this.saveTimer = null;
    this.keepaliveTimer = null;
    this.loaded = this.load();
  }

  /* -------------------------------------------------------------- *
   * Persistence
   * -------------------------------------------------------------- */

  defaults() {
    return {
      version: 1,
      selfId: randomUUID(),
      nick: DEFAULT_NICK,
      relay: DEFAULT_RELAY,
      autoFix: true,
      activeId: '',
      projects: [],
    };
  }

  load() {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      return this.defaults();
    }
    if (!parsed || typeof parsed !== 'object') return this.defaults();
    const base = this.defaults();
    const projects = [];
    for (const entry of Array.isArray(parsed.projects) ? parsed.projects : []) {
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.id !== 'string' || !entry.id) continue;
      if (!isValidTopic(entry.topic)) continue;
      projects.push({
        id: entry.id,
        name: clampText(normalizeName(entry.name), MAX_NAME) || '项目',
        repoPath: typeof entry.repoPath === 'string' ? entry.repoPath : '',
        relay: normalizeRelay(entry.relay) || base.relay,
        topic: entry.topic,
        createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
      });
      if (projects.length >= MAX_PROJECTS) break;
    }
    return {
      version: 1,
      selfId: typeof parsed.selfId === 'string' && parsed.selfId ? parsed.selfId : base.selfId,
      nick: clampText(normalizeName(parsed.nick), MAX_NAME) || DEFAULT_NICK,
      relay: normalizeRelay(parsed.relay) || base.relay,
      autoFix: parsed.autoFix !== false,
      activeId: projects.some((project) => project.id === parsed.activeId) ? parsed.activeId : projects[0] ? projects[0].id : '',
      projects,
    };
  }

  persist() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, SAVE_DELAY);
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref();
  }

  flush() {
    try {
      mkdirp(this.dataDir);
      writeJson(this.file, this.loaded);
    } catch (err) {
      this.log('state save failed: ' + describeError(err));
    }
  }

  logFile(projectId) {
    return path.join(this.projectsDir, projectId + '.json');
  }

  /** One project's local log; loaded lazily and kept in memory. */
  logOf(projectId) {
    if (this.logs.has(projectId)) return this.logs.get(projectId);
    const empty = { events: [], cursor: '' };
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.logFile(projectId), 'utf8'));
    } catch (err) {
      this.logs.set(projectId, empty);
      this.seenIds.set(projectId, new Set());
      return empty;
    }
    const events = Array.isArray(parsed && parsed.events) ? parsed.events.filter((event) => event && event.id && event.type) : [];
    const log = { events: events.slice(-MAX_EVENTS), cursor: typeof parsed.cursor === 'string' ? parsed.cursor : '' };
    this.logs.set(projectId, log);
    this.seenIds.set(projectId, new Set(log.events.map((event) => event.id)));
    return log;
  }

  persistLog(projectId) {
    const log = this.logs.get(projectId);
    if (!log) return;
    try {
      mkdirp(this.projectsDir);
      writeJson(this.logFile(projectId), log);
    } catch (err) {
      this.log('project log save failed: ' + describeError(err));
    }
  }

  /* -------------------------------------------------------------- *
   * Lifecycle
   * -------------------------------------------------------------- */

  start() {
    this.disposers.push(this.routes());
    for (const project of this.loaded.projects) {
      this.logOf(project.id);
      this.startBridge(project);
    }
    this.keepaliveTimer = setInterval(() => {
      for (const stream of this.streams) {
        try {
          stream.write(': keepalive\n\n');
        } catch (err) {
          this.streams.delete(stream);
        }
      }
    }, PAGE_KEEPALIVE);
    if (typeof this.keepaliveTimer.unref === 'function') this.keepaliveTimer.unref();
  }

  dispose() {
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    for (const bridge of this.bridges.values()) bridge.stop();
    for (const stream of this.streams) {
      try {
        stream.end();
      } catch (err) {
        /* already gone */
      }
    }
    this.streams.clear();
    for (const dispose of this.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (err) {
        /* ignore */
      }
    }
    for (const project of this.loaded.projects) this.persistLog(project.id);
    this.flush();
  }

  log(message) {
    try {
      if (process.env.DSH_PROJECTS_DEBUG === '1') console.error('[projects] ' + message);
      const logger = this.ctx.logger;
      if (logger && typeof logger.warn === 'function') logger.warn('[projects] ' + message);
    } catch (err) {
      /* logging must never throw */
    }
  }

  /* -------------------------------------------------------------- *
   * Relay bridges
   * -------------------------------------------------------------- */

  startBridge(project) {
    this.stopBridge(project.id);
    const log = this.logOf(project.id);
    const bridge = new TopicBridge({
      relay: project.relay,
      topic: project.topic,
      projectId: project.id,
      cursor: log.cursor,
      onStatus: (status, error) => {
        this.bridgeStatus.set(project.id, { status, error });
        this.broadcastState();
      },
      onEnvelope: (envelope, attachment) => this.receiveEnvelope(project.id, envelope, attachment),
      onCursor: (cursor) => {
        const current = this.logs.get(project.id);
        if (!current) return;
        current.cursor = cursor;
        this.persistLog(project.id);
      },
    });
    this.bridges.set(project.id, bridge);
    this.bridgeStatus.set(project.id, { status: 'connecting', error: '' });
    bridge.start();
  }

  stopBridge(projectId) {
    const bridge = this.bridges.get(projectId);
    if (!bridge) return;
    bridge.stop();
    this.bridges.delete(projectId);
  }

  bridgeOf(projectId) {
    return this.bridgeStatus.get(projectId) || { status: 'idle', error: '' };
  }

  /* -------------------------------------------------------------- *
   * Events
   * -------------------------------------------------------------- */

  actor(self, kind) {
    return { id: self ? this.loaded.selfId : 'projects-agent', name: self ? this.loaded.nick : '项目助手', kind: kind || 'human' };
  }

  appendEvent(projectId, { id, at, type, actor, data }) {
    const log = this.logOf(projectId);
    const event = {
      id: id || randomId('ev_'),
      seq: nextSeq(log.events),
      at: Number.isFinite(at) ? at : Date.now(),
      type,
      actor,
      data,
    };
    log.events.push(event);
    if (log.events.length > MAX_EVENTS) log.events.splice(0, log.events.length - MAX_EVENTS);
    const seen = this.seenIds.get(projectId) || new Set();
    seen.add(event.id);
    this.seenIds.set(projectId, seen);
    this.persistLog(projectId);
    return event;
  }

  /** Appends locally and publishes to the project's topic. */
  emit(project, event, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const stored = this.appendEvent(project.id, event);
    this.broadcastState();
    if (opts.local === true) return stored;
    void this.publish(project, stored);
    return stored;
  }

  async publish(project, event) {
    try {
      const envelope = createEnvelope({
        project: { id: project.id, name: project.name },
        actor: { id: event.actor.id, name: event.actor.name, kind: event.actor.kind },
        event,
      });
      const body = serializeEnvelope(envelope);
      if (!body) {
        this.log('event too large to publish: ' + event.type);
        return;
      }
      await publishTo(project.relay, project.topic, body);
    } catch (error) {
      this.log('publish failed: ' + describeError(error));
    }
  }

  /** A peer's event: dedupe, append, render. Actions stay local to the sender. */
  receiveEnvelope(projectId, envelope, attachment) {
    const project = this.project(projectId);
    if (!project || envelope.project.id !== project.id) return;
    const seen = this.seenIds.get(projectId) || new Set();
    if (seen.has(envelope.event.id)) return;
    const stored = this.appendEvent(projectId, {
      id: envelope.event.id,
      at: envelope.event.at,
      type: envelope.event.type,
      actor: envelope.actor,
      data: envelope.event.data,
    });
    // A rename travels as an event, so every member's copy shows the same name.
    if (stored.type === 'project.renamed') this.applyName(project, stored.data && stored.data.name);
    this.broadcastState();
    // A picture arrives as a relay attachment; keep a copy right away, so the
    // history survives the relay's cache expiring.
    const image = stored.type === 'message' ? normalizeImage(stored.data && stored.data.image) : null;
    if (image && attachment) void this.fetchImage(stored.id, image, attachment, project.relay);
  }

  /* -------------------------------------------------------------- *
   * State
   * -------------------------------------------------------------- */

  project(projectId) {
    return this.loaded.projects.find((entry) => entry.id === projectId);
  }

  /** Applies a project name to this machine's copy; true when it changed. */
  applyName(project, name) {
    const title = clampText(normalizeName(name), MAX_NAME);
    if (!title || title === project.name) return false;
    project.name = title;
    this.flush();
    return true;
  }

  snapshot() {
    const projects = this.loaded.projects.map((project) => {
      const log = this.logOf(project.id);
      const folded = foldProject(log.events);
      const relay = this.bridgeOf(project.id);
      const members = folded.members.map((member) => ({
        id: member.id,
        name: member.name,
        lastAt: member.lastAt,
        self: member.id === this.loaded.selfId,
      }));
      if (!members.some((member) => member.self)) {
        members.unshift({ id: this.loaded.selfId, name: this.loaded.nick, lastAt: Date.now(), self: true });
      }
      return {
        id: project.id,
        name: project.name,
        repoPath: project.repoPath,
        relay: project.relay,
        topic: project.topic,
        createdAt: project.createdAt,
        relayStatus: relay.status,
        relayError: relay.error || '',
        members,
        messages: folded.messages.map((message) => this.markImage(message)),
        issues: folded.issues,
        counts: {
          messages: folded.messages.length,
          issues: folded.counts,
        },
      };
    });
    return {
      ok: true,
      me: { name: this.loaded.nick },
      activeId: this.loaded.activeId || null,
      autoFix: this.loaded.autoFix,
      // Host-only features the Client must see here before it calls them. The
      // Host half only reloads with the app while the Client half reloads with
      // the page, so a refreshed page can briefly run ahead of its Host.
      capabilities: { image: true, reopenNote: true },
      defaults: {
        relay: this.loaded.relay,
        defaultRepoPath: typeof process.cwd === 'function' ? process.cwd() : os.homedir(),
      },
      projects,
    };
  }

  broadcastState() {
    const state = this.snapshot();
    for (const stream of this.streams) this.frame(stream, { type: 'state', state });
  }

  /* -------------------------------------------------------------- *
   * Pictures
   * -------------------------------------------------------------- */

  /** Where the pictures of this installation live. */
  imagesDir() {
    return path.join(this.dataDir, 'images');
  }

  /** The file that holds one message's picture. */
  imageFile(messageId, type) {
    return path.join(this.imagesDir(), String(messageId) + '.' + imageExtension(type));
  }

  /** Tells the panel whether the picture is on this machine yet. */
  markImage(message) {
    if (!message || !message.image) return message;
    const ready = fs.existsSync(this.imageFile(message.id, message.image.type));
    return { ...message, image: { ...message.image, ready } };
  }

  /** Keeps a copy of a picture on this machine. */
  storeImage(messageId, bytes, type) {
    try {
      mkdirp(this.imagesDir());
      const file = this.imageFile(messageId, type);
      if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
      return file;
    } catch (error) {
      this.log('store image failed: ' + describeError(error));
      return '';
    }
  }

  /**
   * Downloads a picture a peer sent, so the history outlives the relay cache.
   * Only attachment URLs on our own relay's origin are fetched, so a peer
   * cannot point this machine at an arbitrary host.
   */
  async fetchImage(messageId, image, attachment, relay) {
    const url = attachment && typeof attachment.url === 'string' ? attachment.url : '';
    const type = image && IMAGE_TYPES.indexOf(image.type) >= 0 ? image.type : '';
    if (!url || !type || !this.isTrustedAttachment(url, relay)) return '';
    const size = Number.isFinite(attachment.size) ? attachment.size : 0;
    if (size > MAX_IMAGE_BYTES) return '';
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) return '';
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return '';
      const file = this.storeImage(messageId, buffer, type);
      if (file) this.broadcastState();
      return file;
    } catch (error) {
      this.log('fetch image failed: ' + describeError(error));
      return '';
    }
  }

  /** Whether an attachment URL belongs to the relay this project uses. */
  isTrustedAttachment(url, relay) {
    try {
      return new URL(url).origin === new URL(relay).origin;
    } catch (error) {
      return false;
    }
  }

  /** The stored file for a picture message, if this machine already has it. */
  findImageFile(messageId) {
    if (!messageId) return '';
    for (const project of this.loaded.projects) {
      const log = this.logs.get(project.id);
      if (!log) continue;
      for (const event of log.events) {
        const image = event && event.type === 'message' ? normalizeImage(event.data && event.data.image) : null;
        if (!image || event.id !== messageId) continue;
        const file = this.imageFile(messageId, image.type);
        return fs.existsSync(file) ? file : '';
      }
    }
    return '';
  }

  /* -------------------------------------------------------------- *
   * Page stream
   * -------------------------------------------------------------- */

  pageStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    this.streams.add(res);
    this.frame(res, { type: 'hello' });
    this.frame(res, { type: 'state', state: this.snapshot() });
    const remove = () => this.streams.delete(res);
    req.on('close', remove);
    req.on('error', remove);
  }

  frame(res, payload) {
    try {
      res.write('data: ' + JSON.stringify(payload) + '\n\n');
    } catch (err) {
      this.streams.delete(res);
    }
  }

  /* -------------------------------------------------------------- *
   * Message → card pipeline
   * -------------------------------------------------------------- */

  sendMessage(projectId, { text, replyTo }) {
    const project = this.project(projectId);
    if (!project) return { ok: false, error: '项目不存在' };
    const body = typeof text === 'string' ? text.trim() : '';
    if (!body) return { ok: false, error: '消息不能为空' };
    if (body.length > MAX_TEXT) return { ok: false, error: '消息过长' };
    const event = this.emit(project, {
      type: 'message',
      actor: this.actor(true, 'human'),
      data: {
        text: body,
        replyTo: typeof replyTo === 'string' ? replyTo : '',
      },
    });
    this.triageMessage(project, event);
    return { ok: true, state: this.snapshot() };
  }

  /**
   * Sends one picture into the discussion. The bytes stay on this machine and
   * travel to members as a relay attachment; the event itself carries only the
   * description, so the envelope stays under the relay's body limit.
   */
  sendImage(projectId, bytes, { name = '', type = '', replyTo = '' } = {}) {
    const project = this.project(projectId);
    if (!project) return { ok: false, error: '项目不存在' };
    if (IMAGE_TYPES.indexOf(type) < 0) return { ok: false, error: '图片格式不支持' };
    if (!bytes || !bytes.length) return { ok: false, error: '图片是空的' };
    if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: '图片过大（上限 4 MB）' };
    const id = randomUUID();
    const fileName = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    const image = { name: fileName || 'image.' + imageExtension(type), type, size: bytes.length };
    // Store before appending, so the snapshot already reports the picture ready.
    this.storeImage(id, bytes, type);
    const stored = this.emit(
      project,
      {
        id,
        type: 'message',
        actor: this.actor(true, 'human'),
        data: { text: '', replyTo: typeof replyTo === 'string' ? replyTo : '', image },
      },
      { local: true },
    );
    void this.publishImage(project, stored, bytes);
    return { ok: true, state: this.snapshot() };
  }

  /** Publishes one already-appended picture message as a relay attachment. */
  async publishImage(project, event, bytes) {
    try {
      const envelope = createEnvelope({
        project: { id: project.id, name: project.name },
        actor: { id: event.actor.id, name: event.actor.name, kind: event.actor.kind },
        event,
      });
      const body = serializeEnvelope(envelope);
      if (!body) {
        this.log('image envelope too large to publish');
        return;
      }
      await publishPicture(project.relay, project.topic, body, {
        bytes,
        name: event.data.image.name,
        type: event.data.image.type,
      });
    } catch (error) {
      this.log('publish image failed: ' + describeError(error));
    }
  }

  /**
   * The article's Fast Path: deterministic rules decide whether this message
   * deserves a card. The Slow Path (the Worker agent) later verifies the claim.
   * Only the sender's host triages, so two members never open the same card.
   */
  /**
   * The article's two-level filter, on one message.
   *
   * Fast Path: `triage()` decides from the text alone and opens a card directly.
   * Slow Path: when the rules miss but the message still looks like product
   * feedback, one small model call decides whether it deserves a card. The Slow
   * Path only ever opens a `triage` card, so a person still confirms it.
   */
  triageMessage(project, event) {
    const text = event.data && event.data.text;
    const verdict = triage(text);
    if (verdict.hit) {
      this.openCard(project, event, verdict, { semantic: false });
      return;
    }
    if (!looksLikeFeedback(text)) return;
    if (this.semanticPending.has(event.id)) return;
    this.semanticPending.add(event.id);
    void this.semanticTriage(event, verdict)
      .then((semantic) => {
        const merged = mergeVerdict(verdict, semantic);
        if (merged.hit) this.openCard(project, event, merged, { semantic: true });
      })
      .catch((error) => this.log('semantic triage failed: ' + describeError(error)))
      .finally(() => this.semanticPending.delete(event.id));
  }

  /** Opens exactly one card per (project, type, title), whoever notices it first. */
  openCard(project, event, verdict, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const key = titleKey(verdict.title);
    const log = this.logOf(project.id);
    const folded = foldProject(log.events);
    const activeStatus = (status) =>
      status === 'triage' || status === 'open' || status === 'fixing' || status === 'review';
    const text = event.data && typeof event.data.text === 'string' ? event.data.text : '';
    const messageTexts = new Map();
    for (const entry of log.events) {
      if (entry.type === 'message' && entry.data && typeof entry.data.text === 'string') {
        messageTexts.set(entry.id, entry.data.text);
      }
    }
    const duplicate = folded.issues.find((issue) => {
      if (issue.type !== verdict.type || !activeStatus(issue.status)) return false;
      if (titleKey(issue.title) === key) return true;
      const previous = messageTexts.get(issue.sourceEventId);
      return Boolean(previous) && textSimilarity(previous, text) >= 0.6;
    });
    if (duplicate) return;
    const issueId = issueIdFor(project.id, 'title:' + key, verdict.type);
    const now = Date.now();
    const status = opts.semantic ? 'triage' : this.loaded.autoFix && verdict.score >= HIGH_CONFIDENCE ? 'open' : 'triage';
    const issue = {
      id: issueId,
      type: verdict.type,
      title: verdict.title,
      detail: verdict.detail,
      status,
      createdAt: now,
      updatedAt: now,
      sourceEventId: event.id,
      sourceActorName: event.actor.name,
      auto: true,
    };
    this.emit(project, { type: 'issue.created', actor: this.actor(false, 'agent'), data: { issue } });
    // A Worker may already be busy with another card; say so instead of claiming
    // that this one started fixing.
    const startsFix = status === 'open' && !this.fixBlockReason(project.id, issueId);
    this.emit(project, {
      type: 'notice',
      actor: this.actor(false, 'agent'),
      data: {
        text:
          (verdict.type === 'bug' ? '识别到疑似缺陷：' : '识别到体验点：') +
          verdict.title +
          (startsFix
            ? '。开始复现并修复。'
            : status === 'open'
              ? '。已有修复中问题，稍后再点「修复」。'
              : '。待确认，可在看板里点「修复」。'),
        issueId,
      },
    });
    if (startsFix) void this.startFix(project.id, issueId, { auto: true });
  }

  /**
   * Slow Path: one small JSON-only model call for a borderline message. Returns
   * `{ hit, type, title }`, or null when the model is not available.
   */
  async semanticTriage(event, verdict) {
    const llm = this.getService('llm');
    const selection = this.defaultSelection();
    if (!llm || typeof llm.stream !== 'function' || !selection) return null;
    const text = clampText(String(event.data && event.data.text ? event.data.text : ''), MAX_TEXT);
    const system = [
      '你是产品体验巡检助手。判断一条团队讨论消息是否包含需要跟进的产品问题。',
      '只输出一行 JSON，不要解释、不要 Markdown：',
      '{"hit":true,"type":"bug|experience","title":"不超过30字的标题"}',
      '判断标准：',
      '- bug：功能报错、崩溃、数据错误、行为不符合预期、可复现的异常。',
      '- experience：文案/交互/信息结构让人费解、冗余、难找到、易误操作等体验问题。',
      '- hit=false：闲聊、玩笑、纯提问、无具体问题、只是转述无关内容。',
      'title 必须是对问题的客观概括，不要照抄原文。',
    ].join('\n');
    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: '讨论消息：\n' + text }],
      source: { kind: 'user' },
    };
    let output = '';
    const chunks = llm.stream({
      provider: selection.provider,
      model: selection.model,
      system,
      messages: [message],
      temperature: 0,
      maxTokens: 300,
    });
    for await (const chunk of chunks) {
      if (!chunk) continue;
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') output += chunk.text;
      if (chunk.type === 'finish') break;
    }
    this.log('semantic verdict: ' + clampText(output.replace(/\s+/g, ' '), 200));
    return parseSemanticVerdict(output, verdict);
  }

  findIssue(projectId, issueId) {
    const folded = foldProject(this.logOf(projectId).events);
    return folded.issues.find((issue) => issue.id === issueId);
  }

  /**
   * Why a fix cannot start right now, or '' when it can. Only one Worker runs
   * per project, so a click on another card must report the reason instead of
   * silently doing nothing.
   */
  fixBlockReason(projectId, issueId) {
    if (!this.project(projectId)) return '项目不存在';
    if (this.working.has(projectId)) return '已有修复中问题，请稍后再试';
    const issue = this.findIssue(projectId, issueId);
    if (!issue) return '问题卡不存在';
    if (issue.status === 'fixing') return '这个问题正在修复中';
    return '';
  }

  updateIssue(project, issueId, patch) {
    const now = Date.now();
    this.emit(project, {
      type: 'issue.updated',
      actor: this.actor(false, 'agent'),
      data: { issueId, patch: { ...patch, updatedAt: now } },
    });
    return now;
  }

  /**
   * Panel card action: confirm / dismiss / fix / done / reopen. `note` is the
   * optional one-line guidance a person attaches when reopening a card: it is
   * kept on the card so the next Worker knows what to optimise, and reopens
   * without a note clear any stale guidance from the previous round.
   */
  applyIssueAction(projectId, issueId, action, note) {
    const project = this.project(projectId);
    if (!project) return { ok: false, error: '项目不存在' };
    const issue = this.findIssue(projectId, issueId);
    if (!issue) return { ok: false, error: '问题卡不存在' };
    const status = nextStatus(issue.status, action);
    if (!status) return { ok: false, error: '当前状态不支持该操作' };
    if (action === 'fix') {
      const blocked = this.fixBlockReason(projectId, issueId);
      if (blocked) return { ok: false, error: blocked };
      void this.startFix(projectId, issueId, { auto: false });
      return { ok: true, state: this.snapshot() };
    }
    if (action === 'dismiss' || action === 'done') {
      this.updateIssue(project, issueId, { status });
      this.emit(project, {
        type: 'notice',
        actor: this.actor(true, 'human'),
        data: { text: `${this.loaded.nick} 将「${issue.title}」标记为${status === 'done' ? '已完成' : '已忽略'}`, issueId },
      });
      return { ok: true, state: this.snapshot() };
    }
    if (action === 'reopen') {
      const feedback = typeof note === 'string' ? clampText(note, MAX_DETAIL) : '';
      this.updateIssue(project, issueId, { status, feedback });
      this.emit(project, {
        type: 'notice',
        actor: this.actor(true, 'human'),
        data: {
          text: feedback
            ? `${this.loaded.nick} 重新打开了「${issue.title}」，补充说明：${feedback}`
            : `${this.loaded.nick} 重新打开了「${issue.title}」`,
          issueId,
        },
      });
      return { ok: true, state: this.snapshot() };
    }
    this.updateIssue(project, issueId, { status });
    return { ok: true, state: this.snapshot() };
  }

  /* -------------------------------------------------------------- *
   * Worker: reproduce and fix
   * -------------------------------------------------------------- */

  /**
   * Starts one Worker session for a card. Only one Worker runs per project at a
   * time: while one is running, other cards are held back (the reason is
   * reported by `fixBlockReason`) instead of fighting over the same working tree.
   */
  async startFix(projectId, issueId, options) {
    const blocked = this.fixBlockReason(projectId, issueId);
    if (blocked) {
      this.log('fix skipped for ' + issueId + ': ' + blocked);
      return;
    }
    const project = this.project(projectId);
    const issue = this.findIssue(projectId, issueId);
    this.working.set(projectId, issueId);
    const startedAt = Date.now();
    this.updateIssue(project, issueId, {
      status: 'fixing',
      worker: { sessionId: '', status: 'running', startedAt },
      error: '',
    });
    this.emit(project, {
      type: 'fix.progress',
      actor: this.actor(false, 'agent'),
      data: { issueId, status: 'running', startedAt },
    });
    this.emit(project, {
      type: 'notice',
      actor: this.actor(false, 'agent'),
      data: { text: `开始复现并修复「${issue.title}」，完成后回帖。`, issueId },
    });
    const capture = { sessionId: '', text: '', types: new Set(), events: 0 };
    const stopCapture = this.captureSession(capture);
    try {
      const sessionId = randomUUID();
      capture.sessionId = sessionId;
      const outcome = await this.runWorker(project, issue, sessionId, capture);
      const at = Date.now();
      if (outcome.ok) {
        this.updateIssue(project, issueId, {
          status: 'review',
          worker: { sessionId, status: 'idle', startedAt },
          result: { summary: outcome.summary, changedFiles: outcome.changedFiles, tests: outcome.tests, at, ok: true },
          error: '',
        });
        this.emit(project, {
          type: 'fix.progress',
          actor: this.actor(false, 'agent'),
          data: { issueId, status: 'idle', sessionId, startedAt },
        });
        this.emit(project, {
          type: 'message',
          actor: this.actor(false, 'agent'),
          data: { text: '修复完成，待验收：\n' + clampText(outcome.summary, 900), issueId },
        });
      } else {
        this.updateIssue(project, issueId, {
          status: 'open',
          worker: { sessionId, status: 'error', startedAt },
          error: outcome.error,
        });
        this.emit(project, {
          type: 'fix.progress',
          actor: this.actor(false, 'agent'),
          data: { issueId, status: 'error', sessionId, startedAt, note: outcome.error },
        });
        this.emit(project, {
          type: 'notice',
          actor: this.actor(false, 'agent'),
          data: { text: '复现或修复失败：' + excerpt(outcome.error, 300), issueId },
        });
      }
    } catch (error) {
      const message = describeError(error);
      this.updateIssue(project, issueId, { status: 'open', error: message });
      this.emit(project, {
        type: 'fix.progress',
        actor: this.actor(false, 'agent'),
        data: { issueId, status: 'error', startedAt, note: message },
      });
      this.emit(project, {
        type: 'notice',
        actor: this.actor(false, 'agent'),
        data: { text: '修复会话启动失败：' + excerpt(message, 300), issueId },
      });
    } finally {
      stopCapture();
      this.working.delete(projectId);
    }
  }

  /**
   * Records a Worker session's events while it runs. The live event stream is
   * the reliable source of the Worker's last answer: the durable log may not be
   * flushed yet when the turn ends.
   */
  captureSession(capture) {
    try {
      const disposer = this.ctx.on('session/event', (session, event) => {
        if (!capture.sessionId || !session || session.id !== capture.sessionId || !event) return;
        capture.events += 1;
        if (event.type) capture.types.add(event.type);
        if (event.type === 'turn/end' || event.type === 'agent/error') {
          capture.lastEnd = JSON.stringify(event.data || {}).slice(0, 400);
          const reason = event.data && event.data.reason;
          const error = reason && reason.kind === 'error' ? reason.error : undefined;
          if (error) capture.endError = String(error.message || error.code || 'Worker turn failed');
        }
        const message = (event.data && event.data.message) || event.message;
        if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return;
        const blocks = message.content.filter((block) => block && block.type === 'text' && typeof block.text === 'string');
        if (blocks.length) capture.text = blocks.map((block) => block.text).join('\n').trim();
      });
      return () => {
        try {
          if (typeof disposer === 'function') disposer();
          else if (disposer && typeof disposer.dispose === 'function') disposer.dispose();
        } catch (err) {
          /* ignore */
        }
      };
    } catch (err) {
      return () => {};
    }
  }

  workerPrompt(project, issue) {
    return [
      '你是「项目助手」的执行器（Worker），正在处理一条由团队讨论自动识别出的问题。',
      '',
      '项目：' + project.name,
      '仓库/工作目录：' + (project.repoPath || '（未设置）'),
      '问题卡：' + issue.id + '（' + (issue.type === 'bug' ? '缺陷' : '体验点') + '）',
      '标题：' + issue.title,
      '原始反馈：' + issue.detail,
      '反馈人：' + (issue.sourceActorName || '成员'),
      ...(issue.feedback
        ? [
            '重新打开说明：' + issue.feedback,
            '（上一轮修复未通过验收，本次按这条说明继续优化，不要重复已经完成的工作。）',
          ]
        : []),
      '',
      '要求：',
      '1. 先复现或定位根因（读代码、跑测试、最小复现），确认问题真实存在。若无法确认，不要改代码，直接说明判断依据。',
      '2. 确认后做最小修复，贴合现有代码风格，不做无关重构。',
      '3. 尽可能运行相关测试；无法运行时说明原因。',
      '4. 全程自主完成：不要向人提问，不要等待确认。',
      '5. 最后一条回复用中文给出，严格按下面格式：',
      '结论：<一句话结论>',
      '根因：<一段话>',
      '改动：<文件1、文件2，没有改动则写 无>',
      '验证：<跑了什么、结果如何>',
    ].join('\n');
  }

  async runWorker(project, issue, sessionId, capture) {
    const ctx = this.ctx;
    const agents = this.getService('agents');
    if (!agents || typeof agents.create !== 'function') {
      return { ok: false, error: '当前 DSH 没有可用的 Agent 服务（agents）' };
    }
    const repoPath = project.repoPath && isDirectory(project.repoPath) ? project.repoPath : '';
    if (!repoPath) {
      return { ok: false, error: '项目还没有可用的仓库目录，请先在项目设置里填写' };
    }
    const selection = this.defaultSelection();
    this.log('worker model: ' + JSON.stringify(selection || null));
    let handle;
    try {
      handle = await agents.create({
        sessionId,
        meta: { cwd: repoPath },
        agentOptions: selection ? { provider: selection.provider, model: selection.model } : {},
        setup: async (agentCtx) => {
          const presets = this.getService('agentPresets', agentCtx);
          if (presets && typeof presets.mount === 'function') await presets.mount(agentCtx);
        },
      });
    } catch (error) {
      return { ok: false, error: '创建修复会话失败：' + describeError(error) };
    }
    const agent = handle.agent || handle;
    try {
      this.log('worker created: ' + sessionId + ' status=' + String(agent && agent.status));
      const permissionPresets = this.getService('permissionPresets');
      if (permissionPresets && typeof permissionPresets.set === 'function') {
        try {
          permissionPresets.set(agent.session, 'danger-full-access');
        } catch (error) {
          this.log('permission preset failed: ' + describeError(error));
        }
      }
      agent.followup(this.userMessage(this.workerPrompt(project, issue)));
      this.log('worker prompted: ' + sessionId + ' status=' + String(agent && agent.status));
      await this.waitForRunning(agent, 15000);
      this.log('worker after wait: ' + sessionId + ' status=' + String(agent && agent.status));
      const settled = await this.withTimeout(agent.whenIdle(), FIX_TIMEOUT);
      this.log('worker settled: ' + sessionId + ' ok=' + String(settled) + ' status=' + String(agent && agent.status));
      if (!settled) {
        return { ok: false, error: '修复会话超过 ' + Math.round(FIX_TIMEOUT / 60000) + ' 分钟仍未结束，已放弃等待' };
      }
      let summary = await this.readFinalText(sessionId);
      if (!summary && capture && capture.text) {
        summary = capture.text;
        this.log('worker summary from capture');
      }
      if (!summary && capture && capture.endError) {
        return { ok: false, error: '修复会话未能完成：' + capture.endError };
      }
      this.log(
        'worker summary chars: ' + String((summary || '').length) + ' captured events=' +
          String(capture ? capture.events : 0) + ' types=' + (capture ? Array.from(capture.types).join(',') : '') +
          ' end=' + (capture && capture.lastEnd ? capture.lastEnd : ''),
      );
      if (!summary) {
        return { ok: false, error: '修复会话结束了，但没有可读的结论' };
      }
      return {
        ok: true,
        summary,
        changedFiles: parseChangedFiles(summary),
        tests: parseTests(summary),
      };
    } finally {
      // Keep the session for inspection: it stays in the session list, its log
      // is the durable record of what the Worker did.
      void handle;
    }
  }

  /** The deployment's default provider/model, so a Worker session can call a model. */
  defaultSelection() {
    const service = this.getService('agentDefaultModel');
    try {
      if (service && typeof service.currentSelection === 'function') {
        const selection = service.currentSelection();
        if (selection && selection.provider && selection.model) {
          return { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort };
        }
      }
    } catch (err) {
      this.log('default model lookup failed: ' + describeError(err));
    }
    return undefined;
  }

  /** Waits until the agent's driver actually starts, so whenIdle() cannot race it. */
  async waitForRunning(agent, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (agent.status === 'running') return true;
      await sleep(150);
    }
    return false;
  }

  /** Builds the user message a Worker receives (no @deepseek-ai import needed). */
  userMessage(text) {
    return {
      id: 'pm_' + randomId(''),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    };
  }

  async withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), ms);
      if (typeof timer.unref === 'function') timer.unref();
    });
    try {
      const value = await Promise.race([promise.then(() => true), timeout]);
      return value === true;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Last assistant text in the Worker session, via the session query seam. */
  async readFinalText(sessionId) {
    const query = this.getService('sessionQuery');
    if (query && typeof query.readSurface === 'function') {
      try {
        const snapshot = await query.readSurface(sessionId);
        const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : [];
        let text = '';
        for (const event of events) {
          const message = (event && event.message) || (event && event.data && event.data.message);
          if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue;
          const blocks = message.content.filter(
            (block) => block && block.type === 'text' && typeof block.text === 'string',
          );
          if (!blocks.length) continue;
          text = blocks.map((block) => block.text).join('\n').trim();
        }
        return text;
      } catch (error) {
        this.log('readSurface failed: ' + describeError(error));
      }
    }
    const agent = this.getService('agents');
    const live = agent && typeof agent.get === 'function' ? agent.get(sessionId) : undefined;
    const session = live && live.session;
    if (session && Array.isArray(session.events)) {
      let text = '';
      for (const event of session.events) {
        const message = event && event.message;
        if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue;
        const blocks = message.content.filter((block) => block && block.type === 'text' && typeof block.text === 'string');
        if (blocks.length) text = blocks.map((block) => block.text).join('\n').trim();
      }
      return text;
    }
    return '';
  }

  getService(name, context) {
    try {
      const target = context || this.ctx;
      if (target && typeof target.get === 'function') {
        const service = target.get(name);
        if (service) return service;
      }
      return (target && target[name]) || this.ctx[name] || undefined;
    } catch (err) {
      return undefined;
    }
  }

  /* -------------------------------------------------------------- *
   * Project commands
   * -------------------------------------------------------------- */

  createProject({ name, repoPath }) {
    if (this.loaded.projects.length >= MAX_PROJECTS) return { ok: false, error: '项目数量已达上限（' + MAX_PROJECTS + '）' };
    const title = clampText(normalizeName(name), MAX_NAME);
    if (!title) return { ok: false, error: '请填写项目名称' };
    const target = typeof repoPath === 'string' ? repoPath.trim() : '';
    if (!target) return { ok: false, error: '请填写仓库目录' };
    if (!path.isAbsolute(target)) return { ok: false, error: '仓库目录必须是绝对路径' };
    if (!isDirectory(target)) return { ok: false, error: '仓库目录不存在：' + target };
    const project = {
      id: randomUUID(),
      name: title,
      repoPath: target,
      relay: this.loaded.relay,
      topic: createTopic(),
      createdAt: Date.now(),
    };
    this.loaded.projects.push(project);
    this.loaded.activeId = project.id;
    this.logOf(project.id);
    this.flush();
    this.startBridge(project);
    this.broadcastState();
    return { ok: true, state: this.snapshot() };
  }

  renameProject({ projectId, name }) {
    const project = this.project(projectId);
    if (!project) return { ok: false, error: '项目不存在' };
    const title = clampText(normalizeName(name), MAX_NAME);
    if (!title) return { ok: false, error: '请填写项目名称' };
    if (!this.applyName(project, title)) return { ok: true, state: this.snapshot() };
    this.emit(project, {
      type: 'project.renamed',
      actor: this.actor(true, 'human'),
      data: { name: title },
    });
    return { ok: true, state: this.snapshot() };
  }

  joinProject({ code }) {
    const invite = decodeInvite(code);
    if (!invite) return { ok: false, error: '邀请码无效' };
    const existing = this.project(invite.projectId);
    if (existing) {
      this.loaded.activeId = existing.id;
      this.flush();
      this.broadcastState();
      return { ok: true, state: this.snapshot() };
    }
    if (this.loaded.projects.length >= MAX_PROJECTS) return { ok: false, error: '项目数量已达上限（' + MAX_PROJECTS + '）' };
    const repoPath = invite.repoPath && isDirectory(invite.repoPath) ? invite.repoPath : '';
    const project = {
      id: invite.projectId,
      name: invite.name,
      repoPath,
      relay: invite.relay,
      topic: invite.topic,
      createdAt: Date.now(),
    };
    this.loaded.projects.push(project);
    this.loaded.activeId = project.id;
    this.logOf(project.id);
    this.flush();
    this.startBridge(project);
    this.emit(project, {
      type: 'member.joined',
      actor: this.actor(true, 'human'),
      data: { projectName: project.name },
    });
    this.broadcastState();
    return { ok: true, state: this.snapshot() };
  }

  inviteCode(projectId) {
    const project = this.project(projectId);
    if (!project) return { ok: false, error: '项目不存在' };
    const code = encodeInvite({
      relay: project.relay,
      topic: project.topic,
      projectId: project.id,
      name: project.name,
      inviter: this.loaded.nick,
      repoPath: project.repoPath,
    });
    if (!code) return { ok: false, error: '生成邀请码失败' };
    return { ok: true, code };
  }

  setActive(projectId) {
    const project = this.project(projectId);
    if (!project) return { ok: false, error: '项目不存在' };
    this.loaded.activeId = project.id;
    this.flush();
    this.broadcastState();
    return { ok: true, state: this.snapshot() };
  }

  saveSettings(body) {
    if (typeof body.myName === 'string') {
      const nick = clampText(normalizeName(body.myName), MAX_NAME);
      if (!nick) return { ok: false, error: '昵称不能为空' };
      this.loaded.nick = nick;
    }
    if (typeof body.autoFix === 'boolean') this.loaded.autoFix = body.autoFix;
    this.flush();
    this.broadcastState();
    return { ok: true, state: this.snapshot() };
  }

  reconnectRelay(projectId) {
    const project = this.project(projectId);
    if (!project) return { ok: false, error: '项目不存在' };
    this.startBridge(project);
    return { ok: true, relay: this.bridgeOf(projectId) };
  }

  /* -------------------------------------------------------------- *
   * HTTP route
   * -------------------------------------------------------------- */

  routes() {
    return this.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: (req, res) => this.handleHttp(req, res),
    });
  }

  async handleHttp(req, res) {
    const json = (statusValue, value) => {
      try {
        const body = JSON.stringify(value);
        res.writeHead(statusValue, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Length': Buffer.byteLength(body),
        });
        res.end(body);
      } catch (err) {
        try {
          res.destroy();
        } catch (inner) {
          /* socket already gone */
        }
      }
    };
    let suffix = '/';
    let url;
    try {
      url = new URL(req.url, 'http://127.0.0.1');
      suffix = url.pathname.slice(ROUTE_PREFIX.length) || '/';
    } catch (err) {
      json(400, { ok: false, error: '请求地址无效' });
      return;
    }
    const payload = async () => {
      try {
        const body = await readBody(req);
        return JSON.parse(body || '{}') || {};
      } catch (err) {
        return null;
      }
    };
    try {
      if (req.method === 'GET' && suffix === '/state') {
        json(200, this.snapshot());
        return;
      }
      if (req.method === 'GET' && suffix === '/events') {
        this.pageStream(req, res);
        return;
      }
      if (req.method === 'GET' && suffix === '/image') {
        const file = this.findImageFile(url.searchParams.get('id') || '');
        if (!file) {
          json(404, { ok: false, error: '图片不存在' });
          return;
        }
        try {
          const bytes = fs.readFileSync(file);
          res.writeHead(200, {
            'Content-Type': imageTypeOf(file),
            'Content-Length': bytes.length,
            'Cache-Control': 'private, max-age=86400',
          });
          res.end(bytes);
        } catch (error) {
          json(500, { ok: false, error: '图片读取失败' });
        }
        return;
      }
      if (req.method !== 'POST') {
        json(405, { ok: false, error: '不支持的方法' });
        return;
      }
      if (suffix === '/image') {
        const type = (req.headers['content-type'] || '').split(';')[0].trim();
        const bytes = await readBytes(req, MAX_IMAGE_BYTES + 1024);
        if (!bytes) {
          json(400, { ok: false, error: '图片是空的' });
          return;
        }
        const result = this.sendImage(url.searchParams.get('id') || '', bytes, {
          name: url.searchParams.get('name') || '',
          type,
          replyTo: url.searchParams.get('replyTo') || '',
        });
        json(result.ok ? 200 : 400, result);
        return;
      }
      const body = await payload();
      if (!body) {
        json(400, { ok: false, error: '请求体不是合法 JSON' });
        return;
      }
      let result;
      if (suffix === '/create') result = this.createProject(body);
      else if (suffix === '/rename') result = this.renameProject(body);
      else if (suffix === '/join') result = this.joinProject(body);
      else if (suffix === '/select') result = this.setActive(body.projectId);
      else if (suffix === '/invite') result = this.inviteCode(body.projectId);
      else if (suffix === '/send') result = this.sendMessage(body.projectId, body);
      else if (suffix === '/issue')
        result = this.applyIssueAction(body.projectId, body.issueId, body.action, body.note);
      else if (suffix === '/settings') result = this.saveSettings(body);
      else if (suffix === '/relay') result = this.reconnectRelay(body.projectId);
      else {
        json(404, { ok: false, error: '未知接口' });
        return;
      }
      json(result.ok ? 200 : 400, result);
    } catch (error) {
      json(500, { ok: false, error: describeError(error) });
    }
  }
}

/** Pulls the `改动：` line out of a Worker's closing summary. */
function parseChangedFiles(summary) {
  const line = String(summary || '')
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => /^改动[:：]/.test(entry));
  if (!line) return [];
  const value = line
    .replace(/^改动[:：]/, '')
    .replace(/[（(].*$/, '')
    .trim();
  if (!value || /^无$/.test(value)) return [];
  return value
    .split(/[、,，]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 20);
}

/** Pulls the `验证：` line out of a Worker's closing summary. */
function parseTests(summary) {
  const line = String(summary || '')
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => /^验证[:：]/.test(entry));
  return line ? line.replace(/^验证[:：]/, '').trim().slice(0, 200) : '';
}


/** Parses the Slow Path model's one-line JSON, tolerating fences and prose. */
function parseSemanticVerdict(raw, verdict) {
  const text = typeof raw === 'string' ? raw : '';
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    return null;
  }
  if (!parsed || parsed.hit !== true) return null;
  const type = parsed.type === 'bug' ? 'bug' : 'experience';
  const title =
    typeof parsed.title === 'string' && parsed.title.trim()
      ? parsed.title.trim()
      : verdict && verdict.title
        ? verdict.title
        : type === 'bug'
          ? '疑似缺陷'
          : '体验问题';
  return { hit: true, type, title };
}
