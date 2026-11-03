/**
 * Projects wire protocol and domain fold.
 *
 * Everything here is pure: no Node APIs, no Cordis APIs, no browser APIs.
 * Both halves of the plugin (Host log, browser panel) and the tests fold the
 * same event stream with the same functions, so the panel never re-derives
 * domain rules on its own.
 *
 * Model: one project is one relay topic. Every member's DSH subscribes to the
 * topic and publishes the same small JSON envelopes; the relay is stateless for
 * us. A project's own history is an append-only event log kept on each member's
 * machine, so the panel is always a fold of that log.
 */

/** Prefix of an invite code (relay + topic + project identity + inviter). */
export const INVITE_PREFIX = 'DSHPROJ1:';

/** Default relay: a public, account-free pub/sub HTTP service. */
export const DEFAULT_RELAY = 'https://ntfy.sh';

/** Envelope version written into every published event. */
export const ENVELOPE_VERSION = 3;

/** Longest user text accepted by the composer, in characters. */
export const MAX_TEXT = 2000;

/** Longest display name, in characters. */
export const MAX_NAME = 40;

/** Longest issue title / detail kept in a card. */
export const MAX_TITLE = 80;
export const MAX_DETAIL = 400;

/** Largest picture a message may carry, in bytes. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** The picture types the relay may carry as an attachment. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Relay bodies above this many bytes are rejected before publish. */
export const MAX_ENVELOPE_BYTES = 3800;

/** Events kept per project on this machine. */
export const MAX_EVENTS = 4000;

/** Messages the panel renders. */
export const MAX_VIEW_MESSAGES = 200;

/** Relay topic rules: alphanumerics, dashes, underscores; 1..64 characters. */
const TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Shared prefix so a random project topic is recognizable. */
const TOPIC_ROOT = 'dshproj';

/** Every event type this protocol knows. */
export const EVENT_TYPES = [
  'message',
  'member.joined',
  'project.renamed',
  'issue.created',
  'issue.updated',
  'fix.progress',
  'notice',
];

/** Issue types and their human labels. */
export const ISSUE_TYPES = ['bug', 'experience'];

/** Issue lifecycle. `triage` waits for a person; `open` waits for a worker. */
export const ISSUE_STATUSES = ['triage', 'open', 'fixing', 'review', 'done', 'dismissed'];

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

export function normalizeRelay(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.search || parsed.hash) return null;
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

export function normalizeName(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

/**
 * Keeps only the description of a picture; its bytes travel as a relay
 * attachment, never inside the envelope.
 */
export function normalizeImage(image) {
  if (!image || typeof image !== 'object') return null;
  const type =
    typeof image.type === 'string' && IMAGE_TYPES.indexOf(image.type) >= 0 ? image.type : '';
  if (!type) return null;
  return {
    name: typeof image.name === 'string' ? image.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '',
    type,
    size: Number.isFinite(image.size) ? Math.max(0, Math.round(image.size)) : 0,
  };
}

export function isValidTopic(value) {
  return typeof value === 'string' && TOPIC_PATTERN.test(value);
}

export function createTopic(randomBytes) {
  const bytes = randomBytes || defaultRandomBytes;
  const buf = bytes(8);
  let suffix = '';
  for (let index = 0; index < buf.length; index += 1) {
    suffix += buf[index].toString(16).padStart(2, '0');
  }
  return TOPIC_ROOT + '-' + suffix;
}

function defaultRandomBytes(length) {
  const out = new Uint8Array(length);
  const cryptoObject = typeof globalThis === 'object' ? globalThis.crypto : undefined;
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    cryptoObject.getRandomValues(out);
    return out;
  }
  for (let index = 0; index < length; index += 1) {
    out[index] = Math.floor(Math.random() * 256);
  }
  return out;
}

/** Random lowercase hex id; only has to be unique, not secret-grade. */
export function randomId(prefix, randomBytes) {
  const bytes = randomBytes || defaultRandomBytes;
  const buf = bytes(8);
  let suffix = '';
  for (let index = 0; index < buf.length; index += 1) {
    suffix += buf[index].toString(16).padStart(2, '0');
  }
  return (prefix || '') + suffix;
}

/** 32-bit FNV-1a; used only to make derived ids stable across members. */
export function stableHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Stable id for the issue derived from one message, so two members agree. */
export function issueIdFor(projectId, sourceEventId, type) {
  return 'is_' + stableHash(String(projectId) + ':' + String(sourceEventId) + ':' + String(type));
}

export function clampText(value, limit) {
  if (typeof value !== 'string') return '';
  return value.length > limit ? value.slice(0, limit) : value;
}

/** Short single-line excerpt for previews and card titles. */
export function excerpt(value, limit) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - 1)) + '…';
}

/* ------------------------------------------------------------------ *
 * Invite codes
 * ------------------------------------------------------------------ */

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const rest = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const base64 = padded + rest;
  const binary = typeof atob === 'function' ? atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function codePayload(raw) {
  if (typeof raw !== 'string') return '';
  let trimmed = raw.trim();
  if (!trimmed) return '';
  const at = trimmed.indexOf(INVITE_PREFIX);
  if (at >= 0) trimmed = trimmed.slice(at + INVITE_PREFIX.length);
  return trimmed.split(/\s+/)[0] || '';
}

function decodeJsonPayload(encoded) {
  if (!encoded) return null;
  try {
    const value = JSON.parse(fromBase64Url(encoded));
    return value && typeof value === 'object' ? value : null;
  } catch (err) {
    return null;
  }
}

/** Builds the pasteable invite: relay + topic + project identity + inviter. */
export function encodeInvite({ relay, topic, projectId, name, inviter, repoPath }) {
  const normalizedRelay = normalizeRelay(relay);
  if (!normalizedRelay || !isValidTopic(topic) || typeof projectId !== 'string' || !projectId) return '';
  const payload = JSON.stringify({
    r: normalizedRelay,
    t: topic,
    p: projectId,
    n: clampText(normalizeName(name), MAX_NAME),
    i: clampText(normalizeName(inviter), MAX_NAME),
    w: typeof repoPath === 'string' ? repoPath.slice(0, 300) : '',
  });
  return INVITE_PREFIX + toBase64Url(payload);
}

/** Unpacks an invite code; returns null for anything malformed. */
export function decodeInvite(code) {
  if (typeof code !== 'string' || !code.includes(INVITE_PREFIX)) return null;
  const payload = decodeJsonPayload(codePayload(code));
  if (!payload) return null;
  const relay = normalizeRelay(payload.r);
  if (!relay || !isValidTopic(payload.t) || typeof payload.p !== 'string' || !payload.p) return null;
  return {
    relay,
    topic: payload.t,
    projectId: payload.p,
    name: clampText(normalizeName(payload.n), MAX_NAME) || '未命名项目',
    inviter: clampText(normalizeName(payload.i), MAX_NAME),
    repoPath: typeof payload.w === 'string' ? payload.w : '',
  };
}

/* ------------------------------------------------------------------ *
 * Envelopes
 * ------------------------------------------------------------------ */

/** Builds the JSON published for one shared event. */
export function createEnvelope({ project, actor, event }) {
  return {
    v: ENVELOPE_VERSION,
    project: {
      id: String(project.id),
      name: clampText(String(project.name || ''), MAX_NAME) || '项目',
    },
    actor: {
      id: String(actor.id),
      name: clampText(normalizeName(actor.name), MAX_NAME) || '成员',
      kind: actor.kind === 'agent' ? 'agent' : 'human',
    },
    event: {
      id: String(event.id),
      at: Number.isFinite(event.at) ? Math.round(event.at) : Date.now(),
      type: EVENT_TYPES.indexOf(event.type) >= 0 ? event.type : 'notice',
      data: sanitizeData(event.type, event.data),
    },
  };
}

function sanitizeData(type, data) {
  const source = data && typeof data === 'object' ? data : {};
  if (type === 'message') {
    const image = normalizeImage(source.image);
    return {
      text: clampText(typeof source.text === 'string' ? source.text : '', MAX_TEXT),
      replyTo: typeof source.replyTo === 'string' ? source.replyTo : '',
      issueId: typeof source.issueId === 'string' ? source.issueId : '',
      ...(image ? { image } : {}),
    };
  }
  if (type === 'notice') {
    return {
      text: clampText(typeof source.text === 'string' ? source.text : '', MAX_TEXT),
      issueId: typeof source.issueId === 'string' ? source.issueId : '',
    };
  }
  if (type === 'fix.progress') {
    return {
      issueId: typeof source.issueId === 'string' ? source.issueId : '',
      status: source.status === 'running' || source.status === 'error' ? source.status : 'idle',
      sessionId: typeof source.sessionId === 'string' ? source.sessionId : '',
      note: clampText(typeof source.note === 'string' ? source.note : '', MAX_TEXT),
      startedAt: Number.isFinite(source.startedAt) ? Math.round(source.startedAt) : 0,
    };
  }
  if (type === 'issue.created') {
    return { issue: sanitizeIssue(source.issue) };
  }
  if (type === 'issue.updated') {
    return {
      issueId: typeof source.issueId === 'string' ? source.issueId : '',
      patch: sanitizeIssuePatch(source.patch),
    };
  }
  if (type === 'member.joined') {
    return { projectName: clampText(typeof source.projectName === 'string' ? source.projectName : '', MAX_NAME) };
  }
  if (type === 'project.renamed') {
    return { name: clampText(normalizeName(source.name), MAX_NAME) };
  }
  return {};
}

/** Keeps only the fields a peer is allowed to write into a card. */
export function sanitizeIssue(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const status = ISSUE_STATUSES.indexOf(source.status) >= 0 ? source.status : 'triage';
  return {
    id: typeof source.id === 'string' ? source.id : '',
    type: source.type === 'experience' ? 'experience' : 'bug',
    title: clampText(typeof source.title === 'string' ? source.title : '', MAX_TITLE),
    detail: clampText(typeof source.detail === 'string' ? source.detail : '', MAX_DETAIL),
    status,
    createdAt: Number.isFinite(source.createdAt) ? Math.round(source.createdAt) : Date.now(),
    updatedAt: Number.isFinite(source.updatedAt) ? Math.round(source.updatedAt) : Date.now(),
    sourceEventId: typeof source.sourceEventId === 'string' ? source.sourceEventId : '',
    sourceActorName: clampText(normalizeName(source.sourceActorName), MAX_NAME),
    auto: source.auto === true,
    ...(typeof source.feedback === 'string' && source.feedback
      ? { feedback: clampText(source.feedback, MAX_DETAIL) }
      : {}),
    ...(source.worker && typeof source.worker === 'object'
      ? {
          worker: {
            sessionId: typeof source.worker.sessionId === 'string' ? source.worker.sessionId : '',
            status:
              source.worker.status === 'running' || source.worker.status === 'error'
                ? source.worker.status
                : 'idle',
            startedAt: Number.isFinite(source.worker.startedAt) ? Math.round(source.worker.startedAt) : 0,
          },
        }
      : {}),
    ...(source.result && typeof source.result === 'object'
      ? {
          result: {
            summary: clampText(typeof source.result.summary === 'string' ? source.result.summary : '', MAX_DETAIL),
            changedFiles: Array.isArray(source.result.changedFiles)
              ? source.result.changedFiles.filter((entry) => typeof entry === 'string').slice(0, 40)
              : [],
            tests: clampText(typeof source.result.tests === 'string' ? source.result.tests : '', 200),
            at: Number.isFinite(source.result.at) ? Math.round(source.result.at) : Date.now(),
            ok: source.result.ok === true,
          },
        }
      : {}),
    ...(typeof source.error === 'string' && source.error ? { error: clampText(source.error, 300) } : {}),
  };
}

/** Keeps only the fields a peer is allowed to change on an existing card. */
export function sanitizeIssuePatch(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const patch = {};
  if (ISSUE_STATUSES.indexOf(source.status) >= 0) patch.status = source.status;
  if (typeof source.title === 'string') patch.title = clampText(source.title, MAX_TITLE);
  if (typeof source.detail === 'string') patch.detail = clampText(source.detail, MAX_DETAIL);
  // Reopen guidance: a non-empty string replaces it, an empty one clears it.
  if (typeof source.feedback === 'string') patch.feedback = clampText(source.feedback, MAX_DETAIL);
  if (Number.isFinite(source.updatedAt)) patch.updatedAt = Math.round(source.updatedAt);
  if (source.worker && typeof source.worker === 'object') {
    patch.worker = {
      sessionId: typeof source.worker.sessionId === 'string' ? source.worker.sessionId : '',
      status:
        source.worker.status === 'running' || source.worker.status === 'error' ? source.worker.status : 'idle',
      startedAt: Number.isFinite(source.worker.startedAt) ? Math.round(source.worker.startedAt) : 0,
    };
  }
  if (source.result && typeof source.result === 'object') {
    patch.result = {
      summary: clampText(typeof source.result.summary === 'string' ? source.result.summary : '', MAX_DETAIL),
      changedFiles: Array.isArray(source.result.changedFiles)
        ? source.result.changedFiles.filter((entry) => typeof entry === 'string').slice(0, 40)
        : [],
      tests: clampText(typeof source.result.tests === 'string' ? source.result.tests : '', 200),
      at: Number.isFinite(source.result.at) ? Math.round(source.result.at) : Date.now(),
      ok: source.result.ok === true,
    };
  }
  if (typeof source.error === 'string') patch.error = clampText(source.error, 300);
  return patch;
}

/** Validates a received envelope; returns null for unrelated relay traffic. */
export function parseEnvelope(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (!value || typeof value !== 'object' || value.v !== ENVELOPE_VERSION) return null;
  const project = value.project;
  const actor = value.actor;
  const event = value.event;
  if (!project || typeof project.id !== 'string' || !project.id) return null;
  if (!actor || typeof actor.id !== 'string' || !actor.id) return null;
  if (!event || typeof event.id !== 'string' || !event.id) return null;
  const type = EVENT_TYPES.indexOf(event.type) >= 0 ? event.type : null;
  if (!type) return null;
  const data = sanitizeData(type, event.data);
  if (type === 'message' && !data.text && !data.image) return null;
  if (type === 'issue.created' && !data.issue.id) return null;
  if (type === 'project.renamed' && !data.name) return null;
  return {
    project: { id: project.id, name: clampText(normalizeName(project.name), MAX_NAME) || '项目' },
    actor: {
      id: actor.id,
      name: clampText(normalizeName(actor.name), MAX_NAME) || '成员',
      kind: actor.kind === 'agent' ? 'agent' : 'human',
    },
    event: {
      id: event.id,
      at: Number.isFinite(event.at) ? Math.round(event.at) : Date.now(),
      type,
      data,
    },
  };
}

/** Serializes an envelope and enforces the relay body cap. */
export function serializeEnvelope(envelope) {
  const body = JSON.stringify(envelope);
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > MAX_ENVELOPE_BYTES) return null;
  return body;
}

/** One-line JSON for a card or a log line; never throws. */
export function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return '';
  }
}

/* ------------------------------------------------------------------ *
 * Fast-path triage
 * ------------------------------------------------------------------ */

/** Messages that only acknowledge or joke; they never open a card. */
const ACK = /^(?:收到|好的?|好嘞|可以|行|没问题|ok|okay|嗯+|谢谢|感谢|辛苦了?|哈哈+|hhh+|👍+|早|在吗)[。.!！?？~～]*$/i;

const BUG_WORDS = [
  '报错',
  '报了个错',
  '崩溃',
  '闪退',
  '白屏',
  '黑屏',
  '卡死',
  '卡住',
  '没反应',
  '无响应',
  '不生效',
  '失效',
  '不工作',
  '错误',
  '异常',
  '失败',
  '挂掉',
  '打不开',
  '点不动',
  '丢数据',
  '不对',
  '错了',
  '算错',
  '有问题',
  '不一致',
  '不准确',
  'bug',
  'error',
  'exception',
  'crash',
  'broken',
  'fail',
  'failed',
  'freeze',
  'hang',
];

const REPRO_WORDS = ['复现', '重现', '必现', '偶现', '再次出现', 'reproduce', 'repro', 'steps to'];

const UX_WORDS = [
  '体验',
  '难用',
  '不好用',
  '不直观',
  '看不懂',
  '找不到',
  '繁琐',
  '多余',
  '卡顿',
  '太慢',
  '延迟',
  '不顺手',
  '别扭',
  '麻烦',
  '建议',
  '优化',
  '应该',
  '希望',
  '不清晰',
  '太长',
  '太短',
  '太长',
  '啰嗦',
  '冗余',
  '删掉',
  '去掉',
  '合并',
  '信息过载',
  '太满',
  '太挤',
  '太空',
  '不明确',
  '不清楚',
  '不友好',
  '不顺畅',
  '打断',
  '容易误',
  '引导不清',
  'confusing',
  'clunky',
  'slow',
  'annoying',
  'friction',
  'ux',
];

function countHits(text, words) {
  let hits = 0;
  const found = [];
  for (const word of words) {
    if (text.indexOf(word) >= 0) {
      hits += 1;
      found.push(word);
    }
  }
  return { hits, found };
}

/**
 * Character-bigram similarity in `[0, 1]`: used to recognise that two messages
 * report the same thing (a quote plus a prefix) so they share one card.
 */
export function textSimilarity(left, right) {
  const normalize = (value) =>
    typeof value === 'string' ? value.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase() : '';
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (value) => {
    const set = new Set();
    for (let index = 0; index < value.length - 1; index += 1) set.add(value.slice(index, index + 2));
    return set;
  };
  const leftGrams = grams(a);
  const rightGrams = grams(b);
  if (!leftGrams.size || !rightGrams.size) return 0;
  let shared = 0;
  for (const gram of leftGrams) if (rightGrams.has(gram)) shared += 1;
  return shared / (leftGrams.size + rightGrams.size - shared);
}

/**
 * Whether a message is worth the semantic (Slow Path) check at all: long enough
 * to carry a specific observation, and about the product rather than pure chat.
 * This is deliberately cheaper and more permissive than `triage()`.
 */
export function looksLikeFeedback(text) {
  const raw = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (raw.length < 12) return false;
  if (ACK.test(raw)) return false;
  const hints = [
    '体验',
    '问题',
    '建议',
    '希望',
    '感觉',
    '觉得',
    '是不是',
    '能不能',
    '可以',
    '应该',
    '太长',
    '太短',
    '多余',
    '删掉',
    '去掉',
    '找不到',
    '不好',
    '不清晰',
    '看不懂',
    '麻烦',
    '别扭',
    '不对',
    '错',
    '异常',
    '报错',
    '慢',
    '卡',
    '难',
    '误',
  ];
  const lower = raw.toLowerCase();
  if (hints.some((word) => lower.includes(word))) return true;
  // A quoted UI string plus an opinion is feedback even without keywords.
  return /[「“"][^」”"]{2,}[」”"]/.test(raw) && /(改|删|换|简化|调整)/.test(raw);
}

/**
 * Merges a model verdict into the rule verdict. The model is only trusted for
 * "is this a card at all" and the card's type; the program layer still owns the
 * title fallback and the detail text.
 */
export function mergeVerdict(verdict, semantic) {
  const base = verdict && typeof verdict === 'object' ? verdict : triage('');
  const extra = semantic && typeof semantic === 'object' ? semantic : {};
  if (base.hit) return base;
  if (extra.hit !== true) return base;
  const type = extra.type === 'bug' ? 'bug' : 'experience';
  const title =
    typeof extra.title === 'string' && extra.title.trim()
      ? clampText(extra.title.trim(), MAX_TITLE)
      : base.title || cardTitle(extra.reason || '', type);
  return {
    hit: true,
    type,
    score: 2,
    title,
    detail: base.detail,
    reasons: ['semantic'],
    semantic: true,
  };
}

/**
 * Program-layer triage (the article's Fast Path): decides from the text alone
 * whether a message is a defect or experience report candidate, without a model
 * call. The worker agent later verifies the claim; this function only decides
 * what deserves a card.
 *
 * Returns `{ hit, type, score, title, detail, reasons }`.
 */
export function triage(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  const result = { hit: false, type: 'experience', score: 0, title: '', detail: '', reasons: [] };
  if (!raw || raw.length < 4) return result;
  if (ACK.test(raw)) return result;
  const lower = raw.toLowerCase();
  const bug = countHits(lower, BUG_WORDS);
  const repro = countHits(lower, REPRO_WORDS);
  const ux = countHits(lower, UX_WORDS);
  let score = 0;
  const reasons = [];
  if (bug.hits) {
    score += 2 * bug.hits;
    reasons.push('bug:' + bug.found.join('/'));
  }
  if (repro.hits) {
    score += 3;
    reasons.push('repro:' + repro.found.join('/'));
  }
  if (ux.hits) {
    score += 1.5 * ux.hits;
    reasons.push('ux:' + ux.found.join('/'));
  }
  // A report can arrive as reproduction steps alone ("能稳定复现，步骤如下").
  if (!bug.hits && !ux.hits && !repro.hits) return result;
  const type = bug.hits || repro.hits ? 'bug' : 'experience';
  const title = cardTitle(raw, type);
  const detail = excerpt(raw, MAX_DETAIL);
  const hit = score >= 2 || (type === 'experience' && ux.hits >= 2);
  return { hit, type, score, title, detail, reasons };
}

/**
 * Dedupe key for a card title: two mentions of the same defect converge to one
 * card while the first one is still active. Punctuation, case and whitespace
 * are dropped so "登录页没反应" and "登录页没反应!" agree.
 */
export function titleKey(text) {
  const flat = typeof text === 'string' ? text : '';
  return flat
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, 60);
}

/** A card title from the first clause of the message; never empty. */
export function cardTitle(text, type) {
  const flat = excerpt(text, MAX_TITLE + 20);
  const first = flat.split(/[。.!！?？;；，\n]/)[0].trim();
  const title = (first || flat).slice(0, MAX_TITLE).trim();
  if (title) return title;
  return type === 'bug' ? '疑似缺陷' : '体验问题';
}

/* ------------------------------------------------------------------ *
 * Status transitions
 * ------------------------------------------------------------------ */

/** Maps a panel action to the resulting status, or null when not allowed. */
export function nextStatus(from, action) {
  if (action === 'confirm' && from === 'triage') return 'open';
  if (action === 'dismiss' && (from === 'triage' || from === 'open' || from === 'review' || from === 'done'))
    return 'dismissed';
  if (action === 'fix' && (from === 'triage' || from === 'open' || from === 'review')) return 'fixing';
  if (action === 'done' && from === 'review') return 'done';
  if (action === 'reopen' && (from === 'dismissed' || from === 'done' || from === 'review')) return 'open';
  return null;
}

/** Smallest event seq greater than every seq in the log (seq is local). */
export function nextSeq(events) {
  let max = 0;
  for (const event of events) {
    if (event && Number.isFinite(event.seq) && event.seq > max) max = event.seq;
  }
  return max + 1;
}

/* ------------------------------------------------------------------ *
 * Fold: events → view state
 * ------------------------------------------------------------------ */

function actorKey(actor) {
  return actor && typeof actor.id === 'string' && actor.id ? actor.id : 'anonymous';
}

function issueSort(left, right) {
  return (right.updatedAt || 0) - (left.updatedAt || 0);
}

/**
 * Folds one project's events into the panel view: members, messages and
 * issues. Pure and deterministic, so every member sees the same cards.
 */
export function foldProject(events, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const limit = opts.messageLimit === undefined ? MAX_VIEW_MESSAGES : opts.messageLimit;
  const list = Array.isArray(events) ? events : [];
  const members = new Map();
  const issues = new Map();
  const messages = [];

  for (const event of list) {
    if (!event || !event.type) continue;
    const actor = event.actor || { id: 'anonymous', name: '成员', kind: 'system' };
    const at = Number.isFinite(event.at) ? event.at : 0;
    if (actor.kind === 'human' || event.type === 'member.joined') {
      const key = actorKey(actor);
      const entry = members.get(key) || {
        id: key,
        name: actor.name || '成员',
        firstAt: at,
        lastAt: at,
      };
      entry.name = actor.name || entry.name;
      entry.lastAt = Math.max(entry.lastAt, at);
      members.set(key, entry);
    }
    if (event.type === 'message' || event.type === 'notice') {
      const data = event.data || {};
      const image = event.type === 'message' ? normalizeImage(data.image) : null;
      if (event.type === 'message' && !data.text && !image) continue;
      if (event.type === 'notice' && !data.text) continue;
      messages.push({
        id: event.id,
        at,
        actor: { id: actorKey(actor), name: actor.name || '成员', kind: actor.kind || 'human' },
        text: typeof data.text === 'string' ? data.text : '',
        replyTo: typeof data.replyTo === 'string' ? data.replyTo : '',
        issueId: typeof data.issueId === 'string' ? data.issueId : '',
        kind: event.type === 'notice' ? 'notice' : 'message',
        ...(image ? { image } : {}),
      });
    } else if (event.type === 'issue.created') {
      const issue = sanitizeIssue(event.data && event.data.issue);
      if (!issue.id) continue;
      const existing = issues.get(issue.id);
      issues.set(issue.id, existing ? { ...existing, ...issue } : issue);
    } else if (event.type === 'issue.updated') {
      const data = event.data || {};
      const existing = issues.get(data.issueId);
      if (!existing) continue;
      const patch = sanitizeIssuePatch(data.patch);
      issues.set(data.issueId, { ...existing, ...patch, updatedAt: patch.updatedAt || at || existing.updatedAt });
    }
    // fix.progress, member.joined and project.renamed carry no view payload of their own.
  }

  const byId = new Map();
  for (const message of messages) byId.set(message.id, message);
  const issueById = new Map(Array.from(issues.values()).map((issue) => [issue.id, issue]));
  const issueTypeOf = (issueId) => {
    const issue = issueId ? issueById.get(issueId) : undefined;
    return issue ? issue.type : '';
  };
  const view = messages.slice(-limit).map((message) => {
    const reply = message.replyTo ? byId.get(message.replyTo) : undefined;
    return {
      ...message,
      replyPreview: reply ? excerpt(reply.text, 60) || (reply.image ? '图片' : '') : '',
      issueType: issueTypeOf(message.issueId),
    };
  });

  const issueList = Array.from(issues.values()).sort(issueSort);
  const counts = {
    triage: 0,
    open: 0,
    fixing: 0,
    review: 0,
    done: 0,
    dismissed: 0,
  };
  for (const issue of issueList) counts[issue.status] = (counts[issue.status] || 0) + 1;

  return {
    members: Array.from(members.values()).sort((left, right) => right.lastAt - left.lastAt),
    messages: view,
    issues: issueList,
    counts,
  };
}

/* ------------------------------------------------------------------ *
 * Incremental Server-Sent-Events parser
 * ------------------------------------------------------------------ */

/**
 * Relay streams arrive in arbitrary chunks; feed every decoded chunk into
 * `push` and read complete events out. Only `data:` lines are used, and the
 * `event:` name is kept so callers can skip keepalive/open frames.
 */
export class SseParser {
  constructor() {
    this.buffer = '';
  }

  push(chunk) {
    this.buffer += chunk;
    const events = [];
    let boundary = this.buffer.search(/\r?\n\r?\n/);
    while (boundary >= 0) {
      const raw = this.buffer.slice(0, boundary);
      const match = /\r?\n\r?\n/.exec(this.buffer.slice(boundary));
      this.buffer = this.buffer.slice(boundary + (match ? match[0].length : 2));
      const event = parseEventBlock(raw);
      if (event) events.push(event);
      boundary = this.buffer.search(/\r?\n\r?\n/);
    }
    if (this.buffer.length > 1 << 20) this.buffer = this.buffer.slice(-4096);
    return events;
  }
}

function parseEventBlock(raw) {
  let name = 'message';
  const data = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') name = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  return { event: name, data: data.join('\n') };
}
