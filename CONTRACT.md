# 项目插件实现契约（Host ↔ Client）

本文件是 Host（`index.js` + `protocol.js`）与 Client（`client.js`）之间的唯一接口约定。
实现任何一侧前先读本文件；字段名与取值必须逐字一致。

## 1. 产品定位

一个 DSH 侧边栏面板「项目」：

1. 新建项目（绑定本机一个仓库/工作目录路径），生成邀请码。
2. 被邀请人粘贴邀请码即加入；所有成员在同一个「讨论」里实时发言（跨网络，经 ntfy 公共中继）。
3. 讨论消息进过两级过滤：程序规则（Fast Path）先筛，命中的候选由本机 Worker Agent 复核并尝试复现修复（Slow Path）。
4. 命中的内容变成「问题卡」：`缺陷` 或 `体验点`，进入看板，状态流转 待确认 → 修复中 → 待验收 → 已完成 / 已忽略。
5. 修复由 DSH Agent 会话在本机仓库里执行；完成后摘要与改动回帖到讨论，并更新卡片状态。

## 2. 术语

- **event**：项目事件，见 `protocol.js` 的 `EVENT_TYPES`。人类消息、成员加入、问题卡变更、修复进度都是事件。
- **fold**：按 `seq` 顺序把事件折叠成 `{ members, messages, issues }`。`protocol.foldProject()` 是唯一实现。
- **invite code**：`DSHPROJ1:` + base64url(JSON)，含 relay、topic、projectId、项目名、邀请人昵称。
- **topic**：中继上的项目频道名，`dshproj-<16hex>`。
- **picture**：讨论里的一张图片。事件只带描述 `{ name, type, size }`（见 §3），字节走中继附件（ntfy 的 `PUT /<topic>?message=<envelope>` + `Filename` 头），Host 落盘到 `$DSH_HOME/plugin-data/projects/images/<messageId>.<ext>`，按 `message.id` 读取。

## 3. 事件

```js
{
  id: string,            // 事件唯一 id（消息/卡片用 uuid；卡片也可用确定性 key）
  seq: number,           // 本机日志内递增序号（Host 分配，Client 只读）
  at: number,            // epoch ms
  type: 'message' | 'member.joined' | 'project.renamed' | 'issue.created' | 'issue.updated' | 'fix.progress' | 'notice',
  actor: { id, name, kind: 'human' | 'agent' | 'system' },   // kind=human 才是人类发言
  data: { ... }
}
```

`data` 按 type：

| type | data |
| --- | --- |
| `message` | `{ text: string, replyTo?: string /* 被引用事件 id */, image?: { name: string, type: 'image/png' \| 'image/jpeg' \| 'image/webp' \| 'image/gif', size: number } }` |
| `member.joined` | `{ projectName?: string }` |
| `project.renamed` | `{ name: string }`（≤ 40 字；收到后更新本机项目名的显示） |
| `issue.created` | `{ issue: Issue }` |
| `issue.updated` | `{ issueId: string, patch: Partial<Issue> }` |
| `fix.progress` | `{ issueId, status: 'running' \| 'idle' \| 'error', sessionId?: string, note?: string }` |
| `notice` | `{ text: string, issueId?: string }` |

### Issue

```js
{
  id: string,
  type: 'bug' | 'experience',
  title: string,                 // ≤ 80 字
  detail: string,                // 原文片段，≤ 400 字
  status: 'triage' | 'open' | 'fixing' | 'review' | 'done' | 'dismissed',
  createdAt: number,
  updatedAt: number,
  sourceEventId: string,
  sourceActorName: string,
  auto: boolean,                 // 是否由过滤自动创建
  feedback?: string,             // 最近一次重新打开时的一句话说明，≤ 400 字
  worker?: { sessionId: string, status: 'running' | 'idle' | 'error', startedAt: number },
  result?: { summary: string, changedFiles?: string[], tests?: string, at: number, ok: boolean },
  error?: string
}
```

状态语义：`triage` 等待确认（低置信度）、`open` 已确认待修、`fixing` Worker 运行中、`review` 已产出修复待验收、`done` 验收完成、`dismissed` 忽略。

## 4. Host HTTP API（同源，前缀 `/plugin/projects`）

除 `GET /image` 直接返回图片字节、`GET /events` 是 SSE 外，其余全部返回 JSON；失败返回 `{ ok: false, error: '<可读中文>' }` 且 HTTP 4xx/5xx。

| 方法 | 路径 | 请求体 | 返回 |
| --- | --- | --- | --- |
| GET | `/state` | — | `State`（见 §5） |
| GET | `/events` | — | SSE，`data: {"type":"state","state":State}`，state 变化时推送 |
| POST | `/create` | `{ name, repoPath }` | `{ ok, state }` |
| POST | `/rename` | `{ projectId, name }` | `{ ok, state }` |
| POST | `/join` | `{ code }` | `{ ok, state }` |
| POST | `/select` | `{ projectId }` | `{ ok, state }` |
| POST | `/invite` | `{ projectId }` | `{ ok, code }` |
| POST | `/send` | `{ projectId, text, replyTo? }` | `{ ok, state }`（发送成功即返回，不等过滤/修复） |
| POST | `/image?id=<projectId>&name=<文件名>&replyTo=<事件 id>` | 原始二进制（`Content-Type` 为图片类型） | `{ ok, state }` |
| GET | `/image?id=<messageId>` | — | 图片字节（`Content-Type` 按文件后缀；未落盘 404） |
| POST | `/issue` | `{ projectId, issueId, action: 'fix' \| 'confirm' \| 'dismiss' \| 'reopen' \| 'done', note? }` | `{ ok, state }` |
| POST | `/settings` | `{ myName?, autoFix? }` | `{ ok, state }` |
| POST | `/relay` | `{ projectId }` | `{ ok, relay }`（重连中继，调试用） |

约束：
- `/send` 的 `text` trim 后为空则报错；上限 `MAX_TEXT`。
- `/image` 只接受 `IMAGE_TYPES` 里的类型；字节上限 `MAX_IMAGE_BYTES`（4 MB）；字节与消息事件同时落盘，再异步以附件发布到中继（发布失败只记日志，本机历史不受影响）。
- `/create` 校验 `repoPath` 是已存在的绝对目录；失败要报「路径不存在」。
- `/rename` 的 `name` trim 后为空则报错；只改展示名，`repoPath`/`topic`/`id`/历史都不变；改名后发布一条 `project.renamed`，其他成员收到后同步更新。
- `/join` 校验 code 前缀与字段；重复加入同一个 projectId 视为成功（幂等）。
- `/issue` 的 action 与当前状态不匹配时返回可读错误（例如对 `fixing` 的卡片再点 `fix`）。
- `/issue` 的 `note` 只对 `reopen` 生效：非空时截断到 400 字后写入卡片 `feedback`，并发布一条带 `issueId` 的 `notice` 说明是谁因何重新打开；缺省或空串会清空上一轮的 `feedback`。`feedback` 会随 `issue.updated` 同步给其他成员，并进入下一轮 Worker 提示词。
- `autoFix=true` 时，高置信度自动创建的 issue 直接进入 `open` 并由 Host 自动启动修复；低置信度停 `triage`。`autoFix=false` 时自动创建的 issue 也停 `triage`，需人工点「修复」。

## 5. State（`/state` 返回，Client 直接渲染）

```js
{
  ok: true,
  me: { name: string },
  activeId: string | null,
  autoFix: boolean,
  capabilities: { image: boolean },                        // Host 已加载的能力，Client 据此决定是否调用
  defaults: { relay: string, defaultRepoPath: string },   // 新建项目表单的预填
  projects: [Project]
}
```

注意：`capabilities` 描述的是 Host 半已经加载的能力。Host 半只在应用重启后重新加载，Client 半随页面刷新，所以刚刷新过页面的面板可能暂时拿不到 `capabilities.image`；此时不要调用 `/image`，而要在输入框下提示「重启后生效」。

### Project

```js
{
  id: string,
  name: string,
  repoPath: string,
  relay: string,
  topic: string,
  createdAt: number,
  relayStatus: 'online' | 'connecting' | 'error' | 'idle',
  relayError?: string,
  members: [{ id, name, lastAt: number, self: boolean }],
  messages: [MessageView],      // 最多 200 条，按时间升序
  issues: [Issue],             // 按 updatedAt 降序
  counts: { messages: number, issues: { triage, open, fixing, review, done, dismissed } }
}
```

### MessageView（折叠后的展示视图）

```js
{
  id, at, actor: { id, name, kind: 'human'|'agent'|'system' },
  kind: 'message' | 'notice',   // notice = 居中系统行
  text: string,                 // 图片消息可能为空串
  replyTo?: string,
  replyPreview?: string,        // 被引用消息的 60 字摘要；纯图片回引用为「图片」
  issueId?: string,             // notice 关联的卡片
  issueType?: 'bug' | 'experience',  // 由 issueId 解析得到，空串表示无关联卡片
  image?: { name: string, type: string, size: number, ready: boolean }  // ready=字节已在本机
}
```

注意：`notice` 的 `actor.kind` 仍是 `agent`（项目助手在说话），客户端应以 `kind === 'notice'` 判定系统行，而不是 `actor.kind`。

## 6. 传输与去重

- 共享事件（`message`、`member.joined`、`project.renamed`、`issue.*`、`fix.progress`）以信封发布到中继 topic；本机日志记同一事件，收到自身回声按 `event.id` 去重。
- 信封：`{ v: 3, project: { id, name }, actor: { id, name }, event: { id, at, type, data } }`，`protocol.serializeEnvelope/parseEnvelope` 负责编解码与长度校验（超 `MAX_ENVELOPE_BYTES` 拒绝）。
- 图片：同一条信封作为中继消息正文，图片字节作为中继附件一起发布；对方订阅到的消息帧带 `attachment`，Host 只从本项目 relay 的 origin 下载附件并落盘，消息事件本身仍只带描述。
- 收到他人事件时 Host 重新分配本地 `seq` 后入日志并推送 SSE。

## 7. 自动修复（Worker）

- 触发：`autoFix` 且高置信度，或用户点「修复」。
- 过程：Host 用 `ctx.agents.create()` 在项目 `repoPath` 建 DSH 会话 → `permissionPresets.set(session, 'danger-full-access')` → `agent.followup(createUserMessage(...))` → `whenIdle()`。提示词包含原始反馈；卡片有 `feedback`（上一轮验收未通过、重新打开时留的说明）时也一并带上，并注明本次按说明继续优化。
- 期间向讨论发布 `fix.progress {status:'running'}`（Client 显示「项目助手 正在修复 #xxx」）。
- 结束后通过 `ctx.sessionQuery.readSurface(sessionId)` 读取最后一条 assistant 文本作为摘要，发布 `fix.progress {status:'idle'}` + `notice` 回帖 + `issue.updated → review`。
- 同一项目同一时刻只允许一个 Worker 运行；其余自动创建的 issue 停 `open` 并在讨论里提示。此时再点其他卡片的「修复」返回可读错误「已有修复中问题，请稍后再试」，卡片状态不变（Client 用顶部错误条展示）。
- Worker 失败：`fix.progress {status:'error', note}`，issue 回 `open` 并写 `error`。

## 8. Client 交互（client.js）

- 侧边栏入口：`slot name: 'sidebar.panellist'`，key `projects`，标题「项目」；主面板：`slot name: 'main'`，key `projects`（照抄 `chat-room-1.2.1/client.js` 的注册方式与 id 前缀）。
- 布局：
  - 左栏（240px）：项目列表 + 底部「新建项目」「加入项目」；当前项目高亮。
  - 主区顶栏：项目名（悬停名称时右侧浮现「重命名」铅笔图标）· 成员数 · 中继状态点 · 「邀请」按钮 · 设置齿轮。
  - 主区选项卡：「讨论」/「看板」，看板 tab 上显示待处理数（triage+open）。
  - 讨论 tab：消息流（自己右侧、他人左侧、助手消息带「项目助手」标记与浅蓝底），系统 notice 居中细线样式；输入框 Enter 发送 / Shift+Enter 换行；粘贴图片即直接发送（发送中显示「正在发送图片…」，失败在输入框下方提示原因）；图片气泡点击新窗口打开原图；「引用」可回复某条消息（引用条可取消）。
  - 看板 tab：四组（待确认 + 待修复合并为「待处理」，修复中，待验收，已完成/已忽略），卡片显示类型徽标（缺陷=红、体验点=蓝）、标题、来源人、时间，有重新打开说明时也显示在卡片上；操作按钮：待处理→「修复」「忽略」；修复中→状态文字；待验收→「标记完成」「重新打开」；已完成/已忽略→「重新打开」。「重新打开」先弹一个可选的一句话说明输入框，提交后卡片回到待处理，说明随 `note` 发给 Host。
- 视觉：只用蓝/灰/黑，无阴影堆叠、无渐变、无 emoji；圆角 8px，1px 边框；暗色模式跟随 DSH（使用 `prefers-color-scheme` 或继承 CSS 变量 `--dsh-*` 若有）。
- 文案：中文为主；`DICTS.zh` / `DICTS.en` 内联在 client.js（照抄 chat-room 的 locale 注册方式）。
- 空态：无项目时展示一句说明 + 两个按钮；无消息时一句话；无卡片时一句话。
- 交互细节：发送中禁用按钮；发送失败保留草稿并在输入框下方显示原因；SSE 断开时顶部细条提示并可点击重连；邀请码弹窗展示整段可复制文本。

## 9. 文件分工

| 文件 | 归属 | 说明 |
| --- | --- | --- |
| `client.js` | UI | 只读 API，不写业务逻辑 |
| `protocol.js` | Host | 纯函数，无 Node/浏览器 API |
| `index.js` | Host | 中继订阅、日志、过滤、Worker、HTTP/SSE |
| `locale/*.json` | Host | 插件名/描述 |
| `test/*.test.mjs` | Host | `node --test` |
