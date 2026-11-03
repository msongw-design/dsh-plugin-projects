/**
 * Projects — Client half.
 *
 * A sidebar panel for project rooms: the left rail lists projects, the main
 * column has a discussion stream and an issue board. The Host half owns the
 * relay, the event log, the filter and the repair worker, and exposes a
 * same-origin API under /plugin/projects. This module only renders the State
 * it receives and calls that API; it never invents business logic.
 *
 * Interface: see CONTRACT.md (§4 HTTP API, §5 State, §8 Client interactions).
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-projects',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'projects';
    const PANEL_ID = 'projects';
    const API = '/plugin/projects';
    const PANEL_ORDER = 6;

    const STATUS_PENDING = ['triage', 'open'];
    const STATUS_ARCHIVE = ['done', 'dismissed'];

    /** Largest picture the composer accepts; the Host enforces the same cap. */
    const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

    /* ------------------------------------------------------------------ *
     * Copy: zh is the key-set source of truth, en must stay in sync.
     * ------------------------------------------------------------------ */

    const DICTS = {
      zh: {
        title: '项目',
        projectCount: '{n} 个项目',
        noProjectsRail: '还没有项目',
        newProject: '新建项目',
        joinProject: '加入项目',
        untitledProject: '未命名项目',
        noProjectsTitle: '还没有项目',
        noProjectsHint: '新建一个项目并绑定本机仓库，把邀请码发给同事，就能在这里一起讨论、修问题。',
        pickProjectTitle: '选择一个项目',
        pickProjectHint: '从左边选一个项目开始。',
        loading: '正在加载…',
        loadError: '项目服务没有响应',
        retry: '重试',
        invite: '邀请',
        settings: '设置',
        memberCount: '{n} 位成员',
        relayOnline: '中继正常',
        relayConnecting: '连接中',
        relayError: '中继异常',
        relayIdle: '未连接',
        streamLost: '实时连接已断开，讨论和看板可能不是最新',
        reconnect: '重新连接',
        reconnectRelay: '重连中继',
        relayReconnectFailed: '重连中继失败',
        tabDiscussion: '讨论',
        tabBoard: '看板',
        noMessages: '还没有讨论',
        noMessagesHint: '发第一条消息开始讨论。',
        composerPlaceholder: '输入消息，Enter 发送，Shift+Enter 换行；可直接粘贴图片',
        send: '发送',
        sending: '发送中',
        imageSending: '正在发送图片…',
        imageLoading: '图片加载中…',
        imageBadge: '图片',
        attachFailed: '图片没有发出去，请重试',
        imageNeedsRestart: '发送图片需要重启 DeepSeek Harness 后生效',
        imageTooLarge: '图片太大了（上限 4 MB）',
        reply: '引用',
        cancelReply: '取消引用',
        you: '你',
        unknown: '成员',
        assistantName: '项目助手',
        sendFailedWith: '发送失败：{reason}',
        networkError: '网络异常，请重试',
        selectFailed: '切换项目失败',
        actionFailed: '操作失败',
        working: '处理中',
        sourceFrom: '来自 {name}',
        typeBug: '缺陷',
        typeExperience: '体验点',
        auto: '自动',
        groupPending: '待处理',
        groupFixing: '修复中',
        groupReview: '待验收',
        groupArchive: '已完成 / 已忽略',
        groupEmpty: '暂无',
        noIssuesTitle: '还没有问题卡',
        noIssuesHint: '讨论里被判定为缺陷或体验点的内容会出现在这里。',
        statusTriage: '待确认',
        statusOpen: '待修复',
        statusFixing: '修复中',
        statusReview: '待验收',
        statusDone: '已完成',
        statusDismissed: '已忽略',
        actionFix: '修复',
        actionDismiss: '忽略',
        actionDone: '标记完成',
        actionReopen: '重新打开',
        reopenTitleFor: '重新打开「{title}」',
        reopenHint: '上一轮修复只差些细节时，把还要改的地方写清楚，项目助手下一轮会照着优化。留空也可以，那就继续按原始反馈处理。',
        reopenNoteLabel: '这次还要优化什么（可选）',
        reopenNotePlaceholder: '例如：功能已经能用了，这次只想把按钮间距和右对齐再调一下',
        reopenNoteView: '重新打开说明：{note}',
        reopenNoteNeedsRestart: '当前运行的还是旧版插件，这条说明要重启 DeepSeek Harness 后才会生效；留空可以先把卡片重新打开。',
        assistantWorking: '项目助手正在修复…',
        assistantError: '项目助手修复失败',
        newTitle: '新建项目',
        createHint: '绑定本机一个仓库目录。成员共享讨论，修复也在本机执行。',
        nameLabel: '项目名',
        namePlaceholder: '比如：DSH 插件',
        repoLabel: '仓库路径',
        repoPlaceholder: '/Users/you/code/repo',
        repoHint: '本机已存在的绝对目录',
        needName: '请填写项目名',
        needRepo: '请填写仓库路径',
        create: '创建',
        creating: '创建中',
        rename: '重命名',
        renameTitle: '重命名项目',
        renameHint: '只改这里的显示名，仓库、讨论和看板都不受影响；所有成员会同步看到新名字。',
        needProjectName: '请填写项目名',
        joinTitle: '加入项目',
        joinHint: '把对方发给你的邀请码整段粘进来。',
        codeLabel: '邀请码',
        codePlaceholder: '粘贴 DSHPROJ1: 开头的邀请码',
        needCode: '请粘贴邀请码',
        join: '加入',
        joining: '加入中',
        inviteTitle: '邀请成员',
        inviteHint: '把下面这段发给对方，对方在「加入项目」里粘贴即可。',
        inviteLoading: '正在生成邀请码…',
        inviteFailed: '邀请码生成失败',
        copy: '复制',
        copied: '已复制',
        close: '关闭',
        cancel: '取消',
        save: '保存',
        saving: '保存中',
        settingsTitle: '设置',
        myNameLabel: '我的昵称',
        myNamePlaceholder: '比如：小马',
        autoFixLabel: '自动修复高置信度问题',
        autoFixHint: '开启后，高置信度的问题直接交给项目助手修复；关闭后都停在待处理。',
        needMyName: '请填写昵称',
      },
      en: {
        title: 'Projects',
        projectCount: '{n} projects',
        noProjectsRail: 'No projects yet',
        newProject: 'New project',
        joinProject: 'Join',
        untitledProject: 'Untitled project',
        noProjectsTitle: 'No projects yet',
        noProjectsHint: 'Create a project bound to a local repository and send the invite code to teammates. Discussion and repairs then live here.',
        pickProjectTitle: 'Pick a project',
        pickProjectHint: 'Choose a project on the left.',
        loading: 'Loading…',
        loadError: 'The project service did not respond',
        retry: 'Retry',
        invite: 'Invite',
        settings: 'Settings',
        memberCount: '{n} members',
        relayOnline: 'Relay OK',
        relayConnecting: 'Connecting',
        relayError: 'Relay error',
        relayIdle: 'Offline',
        streamLost: 'Live updates stopped. Discussion and board may be out of date.',
        reconnect: 'Reconnect',
        reconnectRelay: 'Reconnect relay',
        relayReconnectFailed: 'Could not reconnect the relay',
        tabDiscussion: 'Discussion',
        tabBoard: 'Board',
        noMessages: 'Nothing discussed yet',
        noMessagesHint: 'Send the first message.',
        composerPlaceholder: 'Type a message. Enter sends, Shift+Enter adds a line; paste a picture to send it',
        send: 'Send',
        sending: 'Sending',
        imageSending: 'Sending picture…',
        imageLoading: 'Loading picture…',
        imageBadge: 'Picture',
        attachFailed: 'The picture did not go out, please try again',
        imageNeedsRestart: 'Sending pictures takes effect after DeepSeek Harness restarts',
        imageTooLarge: 'That picture is too large (4 MB at most)',
        reply: 'Reply',
        cancelReply: 'Cancel reply',
        you: 'You',
        unknown: 'Member',
        assistantName: 'Project assistant',
        sendFailedWith: 'Send failed: {reason}',
        networkError: 'Network error, try again',
        selectFailed: 'Could not switch project',
        actionFailed: 'Action failed',
        working: 'Working',
        sourceFrom: 'from {name}',
        typeBug: 'Bug',
        typeExperience: 'UX',
        auto: 'auto',
        groupPending: 'To do',
        groupFixing: 'Fixing',
        groupReview: 'To review',
        groupArchive: 'Done / dismissed',
        groupEmpty: 'None',
        noIssuesTitle: 'No issue cards yet',
        noIssuesHint: 'Messages judged as bugs or UX issues appear here.',
        statusTriage: 'Triage',
        statusOpen: 'Open',
        statusFixing: 'Fixing',
        statusReview: 'To review',
        statusDone: 'Done',
        statusDismissed: 'Dismissed',
        actionFix: 'Fix',
        actionDismiss: 'Dismiss',
        actionDone: 'Mark done',
        actionReopen: 'Reopen',
        reopenTitleFor: 'Reopen “{title}”',
        reopenHint: 'If the last fix only missed some details, say what still needs work; the project assistant will follow it next round. Leave it blank to keep the original report.',
        reopenNoteLabel: 'What still needs work (optional)',
        reopenNotePlaceholder: 'e.g. It works now; this round only needs the button spacing and right alignment fixed',
        reopenNoteView: 'Reopen note: {note}',
        reopenNoteNeedsRestart: 'The running app still uses the old plugin, so this note only takes effect after restarting DeepSeek Harness. Leave it blank to reopen the card now.',
        assistantWorking: 'The project assistant is fixing it…',
        assistantError: 'The project assistant failed',
        newTitle: 'New project',
        createHint: 'Bind a local repository directory. Members share the discussion; repairs run locally.',
        nameLabel: 'Project name',
        namePlaceholder: 'e.g. DSH plugins',
        repoLabel: 'Repository path',
        repoPlaceholder: '/Users/you/code/repo',
        repoHint: 'An existing absolute directory on this machine',
        needName: 'Enter a project name',
        needRepo: 'Enter a repository path',
        create: 'Create',
        creating: 'Creating',
        rename: 'Rename',
        renameTitle: 'Rename project',
        renameHint: 'Only the display name changes here; the repository, discussion and board stay the same. Members see the new name too.',
        needProjectName: 'Enter a project name',
        joinTitle: 'Join a project',
        joinHint: 'Paste the invite code a teammate sent you.',
        codeLabel: 'Invite code',
        codePlaceholder: 'Paste the code starting with DSHPROJ1:',
        needCode: 'Paste an invite code',
        join: 'Join',
        joining: 'Joining',
        inviteTitle: 'Invite a member',
        inviteHint: 'Send this to a teammate; they paste it under "Join".',
        inviteLoading: 'Generating an invite code…',
        inviteFailed: 'Could not generate an invite code',
        copy: 'Copy',
        copied: 'Copied',
        close: 'Close',
        cancel: 'Cancel',
        save: 'Save',
        saving: 'Saving',
        settingsTitle: 'Settings',
        myNameLabel: 'My name',
        myNamePlaceholder: 'e.g. Alex',
        autoFixLabel: 'Auto-fix high-confidence issues',
        autoFixHint: 'When on, high-confidence issues go straight to the assistant; when off they wait under To do.',
        needMyName: 'Enter a display name',
      },
    };

    /* ------------------------------------------------------------------ *
     * Helpers
     * ------------------------------------------------------------------ */

    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function fill(template, vars) {
      if (typeof template !== 'string') return '';
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (match, key) =>
        vars[key] === undefined || vars[key] === null ? match : String(vars[key]),
      );
    }

    function truncate(value, max) {
      const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
      if (text.length <= max) return text;
      return text.slice(0, max) + '…';
    }

    function initial(name) {
      const trimmed = (name || '').trim();
      if (!trimmed) return '·';
      const first = Array.from(trimmed)[0] || '·';
      return first.toUpperCase();
    }

    function shortTime(at) {
      const date = new Date(at);
      if (!Number.isFinite(date.getTime())) return '';
      const now = new Date();
      try {
        if (
          date.getFullYear() === now.getFullYear() &&
          date.getMonth() === now.getMonth() &&
          date.getDate() === now.getDate()
        ) {
          return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString([], { month: 'numeric', day: 'numeric' });
      } catch (err) {
        return '';
      }
    }

    function isSelfActor(project, actor, me) {
      if (!actor) return false;
      const members = asArray(project && project.members);
      const self = members.find((member) => member && member.self === true);
      if (self) {
        if (self.id && actor.id) return self.id === actor.id;
        if (self.name && actor.name) return self.name === actor.name;
      }
      if (me && me.name && actor.name) return actor.name === me.name;
      return false;
    }

    function replyPreviewFor(project, message) {
      if (message && typeof message.replyPreview === 'string' && message.replyPreview) {
        return message.replyPreview;
      }
      if (!message || !message.replyTo) return '';
      const found = asArray(project && project.messages).find(
        (entry) => entry && entry.id === message.replyTo,
      );
      if (found && typeof found.text === 'string' && found.text) return truncate(found.text, 60);
      if (found && found.image) return t('imageBadge');
      return '';
    }

    // Notices are folded by the Host with kind:'notice' (CONTRACT §5 lists
    // actor.kind='system' instead), so accept both shapes and treat them as
    // the centered system line in the discussion.
    function isNoticeMessage(message) {
      if (!message) return false;
      if (message.kind === 'notice') return true;
      return !!message.actor && message.actor.kind === 'system';
    }

    // CONTRACT §5 declares MessageView.issueType; the folded view may only
    // carry issueId, so fall back to the card it points at.
    function resolveIssueType(project, message) {
      if (!message) return '';
      if (message.issueType === 'bug' || message.issueType === 'experience') {
        return message.issueType;
      }
      if (!message.issueId) return '';
      const issue = asArray(project && project.issues).find(
        (entry) => entry && entry.id === message.issueId,
      );
      if (issue && (issue.type === 'bug' || issue.type === 'experience')) return issue.type;
      return '';
    }

    function issueCount(project, statuses) {
      if (!project) return 0;
      const counts = project.counts && project.counts.issues;
      if (counts && typeof counts === 'object') {
        let total = 0;
        let measured = false;
        for (const status of statuses) {
          if (typeof counts[status] === 'number') {
            total += counts[status];
            measured = true;
          }
        }
        if (measured) return total;
      }
      return asArray(project.issues).filter(
        (issue) => issue && statuses.indexOf(issue.status) >= 0,
      ).length;
    }

    function relayLabel(status, t) {
      if (status === 'online') return t('relayOnline');
      if (status === 'connecting') return t('relayConnecting');
      if (status === 'error') return t('relayError');
      return t('relayIdle');
    }

    function issueStatusLabel(status, t) {
      if (status === 'triage') return t('statusTriage');
      if (status === 'open') return t('statusOpen');
      if (status === 'fixing') return t('statusFixing');
      if (status === 'review') return t('statusReview');
      if (status === 'done') return t('statusDone');
      if (status === 'dismissed') return t('statusDismissed');
      return '';
    }

    function issueTypeLabel(type, t) {
      if (type === 'bug') return t('typeBug');
      if (type === 'experience') return t('typeExperience');
      return '';
    }

    function copyToClipboard(text) {
      try {
        if (
          typeof navigator !== 'undefined' &&
          navigator.clipboard &&
          typeof navigator.clipboard.writeText === 'function'
        ) {
          return navigator.clipboard.writeText(text);
        }
      } catch (err) {
        /* fall through to the selection path */
      }
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }

    /**
     * Picks the first picture out of a clipboard payload. Only an entry that
     * really carries a picture is taken, so an ordinary text paste stays in
     * the textarea.
     */
    function pickPastedImage(items) {
      const list = items && typeof items.length === 'number' ? Array.from(items) : [];
      for (const item of list) {
        if (!item || typeof item.type !== 'string') continue;
        if (item.type.indexOf('image/') !== 0) continue;
        const file = typeof item.getAsFile === 'function' ? item.getAsFile() : item;
        if (file && typeof file === 'object' && typeof file.type === 'string' && file.type.indexOf('image/') === 0) {
          return file;
        }
      }
      return null;
    }

    /** Shrinks a big photo so it fits the relay comfortably. */
    async function prepareImage(file) {
      const passthrough = { blob: file, name: file.name || 'image', type: file.type };
      if (!file || !file.type || file.size <= 1500 * 1024) return passthrough;
      if (file.type === 'image/gif') return passthrough;
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) =>
          canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.85),
        );
        if (!blob) return passthrough;
        const name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg';
        return { blob, name, type: 'image/jpeg' };
      } catch (err) {
        return passthrough;
      }
    }

    function readError(payload, fallback) {
      if (payload && typeof payload.error === 'string' && payload.error) return payload.error;
      return fallback;
    }

    // The main slot renders only the active panel entry and remounts it when the
    // user navigates away and back, so a composer draft kept in component state
    // would be dropped on every page switch. Keep it outside the component,
    // keyed by project: coming back restores the text, while switching projects
    // still never carries text across.
    const DRAFT_STORE = new Map();

    function readDraft(projectId) {
      if (!projectId) return '';
      const text = DRAFT_STORE.get(projectId);
      return typeof text === 'string' ? text : '';
    }

    function writeDraft(projectId, text) {
      if (!projectId) return;
      if (typeof text === 'string' && text) DRAFT_STORE.set(projectId, text);
      else DRAFT_STORE.delete(projectId);
    }

    const EMPTY_STATE = null;

    /* ------------------------------------------------------------------ *
     * Artwork (inline SVG, currentColor, no external assets)
     * ------------------------------------------------------------------ */

    function projectsGlyph(size) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: 'false',
          style: { display: 'block' },
        },
        [
          h('path', {
            key: 'folder',
            d: 'M3 7.1c0-.8.7-1.5 1.5-1.5h3.4l1.5 1.8h8.1c.8 0 1.5.7 1.5 1.5v7.7c0 .8-.7 1.5-1.5 1.5h-13c-.8 0-1.5-.7-1.5-1.5V7.1Z',
          }),
          h('path', { key: 'line', d: 'M7 12.4h7.4' }),
          h('path', { key: 'dot', d: 'M7 15.2h3.6' }),
        ],
      );
    }

    function ProjectsIcon(props) {
      const size = props && typeof props.size === 'number' && props.size > 0 ? props.size : 20;
      // The sidebar row already paints every panel glyph with the host's label
      // color, so inherit it instead of choosing a lighter secondary tone:
      // sibling panels then keep exactly the same weight as this one.
      return h(
        'span',
        {
          className: 'dsh-proj-panel-icon',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'currentColor',
          },
        },
        projectsGlyph(size),
      );
    }

    function gearGlyph(size) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: 'false',
          style: { display: 'block' },
        },
        [
          h('circle', { key: 'c', cx: 8, cy: 8, r: 2.1 }),
          h('path', {
            key: 'ring',
            d: 'M8 2.2v1.3M8 12.5v1.3M2.2 8h1.3M12.5 8h1.3M3.9 3.9l.9.9M11.2 11.2l.9.9M12.1 3.9l-.9.9M4.8 11.2l-.9.9',
          }),
        ],
      );
    }

    function pencilGlyph(size) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: 'false',
          style: { display: 'block' },
        },
        [
          h('path', { key: 'body', d: 'M10.9 2.9l2.2 2.2-7.3 7.3-2.6.4.4-2.6 7.3-7.3Z' }),
          h('path', { key: 'tip', d: 'M9.6 4.2l2.2 2.2' }),
        ],
      );
    }

    function closeGlyph(size) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          'aria-hidden': true,
          focusable: 'false',
          style: { display: 'block' },
        },
        h('path', { d: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6' }),
      );
    }

    /* ------------------------------------------------------------------ *
     * Styles. Blue / gray / black only, 1px borders, 8px radii, no
     * gradients, no stacked shadows. Dark mode follows prefers-color-scheme.
     * ------------------------------------------------------------------ */

    const CSS = [
      '.dsh-proj-root{--pj-bg:#ffffff;--pj-bg-sunken:#f6f7f9;--pj-bg-raise:#ffffff;--pj-bg-hover:#f1f3f6;--pj-text:#111318;--pj-text-2:#697180;--pj-text-3:#98a0ab;--pj-border:#e4e7eb;--pj-border-strong:#cfd4db;--pj-blue:#3b6ef5;--pj-blue-text:#2f5fe0;--pj-blue-soft:rgba(59,110,245,.08);--pj-blue-border:rgba(59,110,245,.32);--pj-red:#bd3a2f;--pj-red-soft:rgba(189,58,47,.08);--pj-red-border:rgba(189,58,47,.28);position:relative;display:flex;height:100%;min-height:0;overflow:hidden;background:var(--pj-bg);color:var(--pj-text);font-family:inherit;font-size:13px;line-height:1.5;color-scheme:light}',
      '@media (prefers-color-scheme:dark){.dsh-proj-root{--pj-bg:#15171b;--pj-bg-sunken:#191c21;--pj-bg-raise:#1d2026;--pj-bg-hover:#252a32;--pj-text:#eceef1;--pj-text-2:#9aa1ac;--pj-text-3:#6f7783;--pj-border:#2b3038;--pj-border-strong:#3b424d;--pj-blue:#3b6ef5;--pj-blue-text:#8aa6ff;--pj-blue-soft:rgba(125,157,255,.14);--pj-blue-border:rgba(125,157,255,.4);--pj-red:#e07b72;--pj-red-soft:rgba(224,123,114,.14);--pj-red-border:rgba(224,123,114,.36);color-scheme:dark}}',
      '.dsh-proj-rail{display:flex;flex-direction:column;flex:0 0 240px;width:240px;min-width:0;min-height:0;border-right:1px solid var(--pj-border);background:var(--pj-bg-sunken)}',
      '.dsh-proj-rail-head{display:flex;align-items:baseline;gap:8px;flex:0 0 auto;padding:14px 14px 8px}',
      '.dsh-proj-rail-title{margin:0;font-size:14px;font-weight:600;white-space:nowrap}',
      '.dsh-proj-rail-count{font-size:11.5px;color:var(--pj-text-2);white-space:nowrap}',
      '.dsh-proj-rail-list{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-height:0;overflow-y:auto;padding:2px 8px 8px}',
      '.dsh-proj-rail-empty{margin:8px;font-size:12px;line-height:1.6;color:var(--pj-text-2)}',
      '.dsh-proj-rail-item{display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:8px 10px;border:1px solid transparent;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
      '.dsh-proj-rail-item:hover{background:var(--pj-bg-hover)}',
      '.dsh-proj-rail-item[data-active="true"]{background:var(--pj-bg-raise);border-color:var(--pj-border-strong)}',
      '.dsh-proj-rail-item:focus-visible{outline:2px solid var(--pj-blue);outline-offset:-2px}',
      '.dsh-proj-rail-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:500}',
      '.dsh-proj-rail-badge{flex:0 0 auto;font-size:10.5px;color:var(--pj-text-2)}',
      '.dsh-proj-rail-foot{display:flex;align-items:center;gap:6px;flex:0 0 auto;padding:10px 12px;border-top:1px solid var(--pj-border)}',
      '.dsh-proj-rail-foot .dsh-proj-btn{flex:1 1 0;min-width:0}',
      '.dsh-proj-main{display:flex;flex-direction:column;flex:1 1 auto;min-width:0;min-height:0}',
      '.dsh-proj-top{display:flex;align-items:center;gap:10px;flex:0 0 auto;min-height:56px;box-sizing:border-box;padding:10px 20px;border-bottom:1px solid var(--pj-border)}',
      '.dsh-proj-top-title{display:flex;flex-direction:column;gap:1px;min-width:0}',
      '.dsh-proj-top-namerow{display:flex;align-items:center;gap:4px;min-width:0}',
      '.dsh-proj-top-name{margin:0;min-width:0;font-size:14.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-proj-top-rename{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:22px;height:22px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--pj-text-3);cursor:pointer;opacity:0;transition:opacity .12s}',
      '.dsh-proj-top-namerow:hover .dsh-proj-top-rename,.dsh-proj-top-rename:focus-visible{opacity:1}',
      '.dsh-proj-top-rename:hover{background:var(--pj-bg-hover);border-color:var(--pj-border);color:var(--pj-text)}',
      '.dsh-proj-top-rename:focus-visible{outline:2px solid var(--pj-blue);outline-offset:1px}',
      '.dsh-proj-top-sub{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--pj-text-2);white-space:nowrap}',
      '.dsh-proj-dot{display:inline-block;flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:var(--pj-text-3)}',
      '.dsh-proj-dot[data-status="online"]{background:var(--pj-blue)}',
      '.dsh-proj-dot[data-status="error"]{background:var(--pj-red)}',
      '.dsh-proj-dot[data-status="connecting"]{background:transparent;border:1px solid var(--pj-blue)}',
      '.dsh-proj-top-actions{display:flex;align-items:center;gap:6px;margin-left:auto;flex:0 0 auto}',
      '.dsh-proj-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;box-sizing:border-box;padding:0 11px;border:1px solid var(--pj-border);border-radius:8px;background:var(--pj-bg-raise);color:var(--pj-text);font:inherit;font-size:12.5px;font-weight:500;white-space:nowrap;cursor:pointer}',
      '.dsh-proj-btn:hover{background:var(--pj-bg-hover);border-color:var(--pj-border-strong)}',
      '.dsh-proj-btn:focus-visible{outline:2px solid var(--pj-blue);outline-offset:1px}',
      '.dsh-proj-btn[disabled]{opacity:.5;cursor:default}',
      '.dsh-proj-btn--primary{background:var(--pj-blue);border-color:var(--pj-blue);color:#fff}',
      '.dsh-proj-btn--primary:hover{background:var(--pj-blue);border-color:var(--pj-blue);opacity:.92}',
      '.dsh-proj-btn--ghost{border-color:transparent;background:transparent;color:var(--pj-text-2)}',
      '.dsh-proj-btn--ghost:hover{background:var(--pj-bg-hover);border-color:var(--pj-border);color:var(--pj-text)}',
      '.dsh-proj-panel-icon{display:inline-flex;align-items:center;justify-content:center}',
      '.dsh-proj-btn--icon{width:30px;padding:0}',
      '.dsh-proj-btn--sm{height:24px;padding:0 8px;font-size:11.5px;border-radius:6px}',
      '.dsh-proj-btn--accent{background:var(--pj-blue-soft);border-color:var(--pj-blue-border);color:var(--pj-blue-text)}',
      '.dsh-proj-btn--accent:hover{background:var(--pj-blue-soft);border-color:var(--pj-blue);opacity:.92}',
      '.dsh-proj-link{border:0;background:none;padding:0;font:inherit;font-size:12px;color:var(--pj-blue-text);cursor:pointer}',
      '.dsh-proj-link:hover{text-decoration:underline}',
      '.dsh-proj-streambar{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding:6px 20px;border-bottom:1px solid var(--pj-border);background:var(--pj-bg-sunken);font-size:11.5px;color:var(--pj-text-2)}',
      '.dsh-proj-stream-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-proj-streambar .dsh-proj-link{margin-left:auto;flex:0 0 auto}',
      '.dsh-proj-errorbar{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding:6px 20px;border-bottom:1px solid var(--pj-red-border);background:var(--pj-red-soft);color:var(--pj-red);font-size:11.5px}',
      '.dsh-proj-errorbar .dsh-proj-stream-text{flex:1 1 auto}',
      '.dsh-proj-errorbar .dsh-proj-link{color:var(--pj-red);flex:0 0 auto}',
      '.dsh-proj-tabs{display:flex;align-items:center;gap:16px;flex:0 0 auto;padding:0 20px;border-bottom:1px solid var(--pj-border)}',
      '.dsh-proj-tab{display:inline-flex;align-items:center;gap:5px;height:38px;margin-bottom:-1px;padding:0 1px;border:0;border-bottom:2px solid transparent;background:none;color:var(--pj-text-2);font:inherit;font-size:12.5px;cursor:pointer}',
      '.dsh-proj-tab:hover{color:var(--pj-text)}',
      '.dsh-proj-tab:focus-visible{outline:2px solid var(--pj-blue);outline-offset:-2px}',
      '.dsh-proj-tab[data-active="true"]{color:var(--pj-text);font-weight:600;border-bottom-color:var(--pj-blue)}',
      '.dsh-proj-tab-count{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:var(--pj-blue-soft);color:var(--pj-blue-text);font-size:10px;font-weight:600}',
      '.dsh-proj-discussion{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}',
      '.dsh-proj-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:16px 20px 8px}',
      '.dsh-proj-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;min-height:200px;padding:24px;text-align:center;color:var(--pj-text-2)}',
      '.dsh-proj-empty-title{margin:0;font-size:13px;font-weight:500;color:var(--pj-text)}',
      '.dsh-proj-empty-hint{margin:0;font-size:12px;line-height:1.6}',
      '.dsh-proj-msg{display:flex;flex-direction:column;align-items:flex-start;gap:3px;margin-bottom:12px;max-width:100%}',
      '.dsh-proj-msg[data-mine="true"]{align-items:flex-end}',
      '.dsh-proj-msg-head{display:flex;align-items:center;gap:6px;max-width:100%;padding:0 2px}',
      '.dsh-proj-msg[data-mine="true"] .dsh-proj-msg-head{flex-direction:row-reverse}',
      '.dsh-proj-avatar{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:20px;height:20px;border:1px solid var(--pj-border);border-radius:50%;background:var(--pj-bg-sunken);color:var(--pj-text-2);font-size:10.5px;font-weight:600}',
      '.dsh-proj-msg-name{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--pj-text-2)}',
      '.dsh-proj-msg-time{flex:0 0 auto;font-size:10.5px;color:var(--pj-text-3)}',
      '.dsh-proj-agent-tag{display:inline-flex;align-items:center;height:16px;padding:0 6px;border:1px solid var(--pj-blue-border);border-radius:999px;background:var(--pj-blue-soft);color:var(--pj-blue-text);font-size:10.5px;font-weight:500;white-space:nowrap}',
      '.dsh-proj-replybtn{flex:0 0 auto;border:0;background:none;padding:0 2px;color:var(--pj-text-3);font:inherit;font-size:10.5px;cursor:pointer;opacity:0;transition:opacity .12s}',
      '.dsh-proj-msg:hover .dsh-proj-replybtn,.dsh-proj-replybtn:focus-visible{opacity:1}',
      '.dsh-proj-replybtn:hover{color:var(--pj-blue-text)}',
      '.dsh-proj-bubble{max-width:min(560px,82%);padding:7px 11px;border:1px solid var(--pj-border);border-radius:8px;background:var(--pj-bg-raise);font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word}',
      '.dsh-proj-msg[data-mine="true"] .dsh-proj-bubble{background:var(--pj-blue-soft);border-color:var(--pj-blue-border)}',
      '.dsh-proj-msg[data-agent="true"] .dsh-proj-bubble{background:var(--pj-blue-soft);border-color:var(--pj-blue-border)}',
      '.dsh-proj-quote{margin-bottom:5px;padding-left:8px;border-left:2px solid var(--pj-blue-border);color:var(--pj-text-2);font-size:11.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word}',
      '.dsh-proj-image{display:block;max-width:min(320px,100%);max-height:320px;margin:2px 0;border:1px solid var(--pj-border);border-radius:6px;background:var(--pj-bg-sunken);object-fit:contain;cursor:zoom-in}',
      '.dsh-proj-image-pending{display:inline-flex;align-items:center;min-height:24px;padding:2px 8px;border:1px dashed var(--pj-border-strong);border-radius:6px;color:var(--pj-text-3);font-size:11.5px}',
      '.dsh-proj-notice{display:flex;align-items:center;gap:8px;margin:14px 0;color:var(--pj-text-2);font-size:11.5px;line-height:1.5}',
      '.dsh-proj-notice-line{flex:1 1 auto;height:1px;background:var(--pj-border)}',
      '.dsh-proj-notice-text{max-width:78%;text-align:center;word-break:break-word}',
      '.dsh-proj-notice-text .dsh-proj-type{margin-right:6px}',
      '.dsh-proj-composer{display:flex;flex-direction:column;gap:8px;flex:0 0 auto;padding:10px 20px 14px;border-top:1px solid var(--pj-border)}',
      '.dsh-proj-composer-row{display:flex;align-items:flex-end;gap:8px}',
      '.dsh-proj-input{flex:1 1 auto;box-sizing:border-box;min-height:40px;max-height:160px;padding:8px 10px;border:1px solid var(--pj-border);border-radius:8px;background:var(--pj-bg-raise);color:inherit;font:inherit;font-size:13px;line-height:1.5;resize:none;outline:none}',
      '.dsh-proj-input:focus{border-color:var(--pj-blue-border)}',
      '.dsh-proj-input::placeholder{color:var(--pj-text-3)}',
      '.dsh-proj-quotebar{display:flex;align-items:center;gap:8px;padding:5px 9px;border-left:2px solid var(--pj-blue);background:var(--pj-blue-soft);border-radius:0 8px 8px 0;font-size:11.5px;color:var(--pj-text-2)}',
      '.dsh-proj-quote-name{flex:0 0 auto;color:var(--pj-text);font-weight:500}',
      '.dsh-proj-quote-body{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsh-proj-error{margin:0;color:var(--pj-red);font-size:11.5px;line-height:1.5}',
      '.dsh-proj-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-content:start;flex:1 1 auto;min-height:0;overflow-y:auto;padding:14px 20px 24px}',
      '@media (max-width:980px){.dsh-proj-board{grid-template-columns:repeat(2,minmax(0,1fr))}}',
      '.dsh-proj-board-empty{grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:48px 24px;text-align:center;color:var(--pj-text-2)}',
      '.dsh-proj-group{display:flex;flex-direction:column;gap:8px;min-width:0}',
      '.dsh-proj-group-head{display:flex;align-items:center;gap:6px;padding:0 2px 6px;border-bottom:1px solid var(--pj-border)}',
      '.dsh-proj-group-title{font-size:12px;font-weight:600;white-space:nowrap}',
      '.dsh-proj-group-count{margin-left:auto;color:var(--pj-text-2);font-size:11px}',
      '.dsh-proj-group-empty{padding:4px 2px;color:var(--pj-text-3);font-size:11.5px}',
      '.dsh-proj-card{display:flex;flex-direction:column;gap:5px;min-width:0;padding:9px 10px;border:1px solid var(--pj-border);border-radius:8px;background:var(--pj-bg-raise)}',
      '.dsh-proj-card-head{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dsh-proj-type{display:inline-flex;align-items:center;flex:0 0 auto;height:16px;padding:0 6px;border:1px solid transparent;border-radius:4px;font-size:10.5px;font-weight:500;white-space:nowrap}',
      '.dsh-proj-type[data-type="bug"]{color:var(--pj-red);background:var(--pj-red-soft);border-color:var(--pj-red-border)}',
      '.dsh-proj-type[data-type="experience"]{color:var(--pj-blue-text);background:var(--pj-blue-soft);border-color:var(--pj-blue-border)}',
      '.dsh-proj-chip{display:inline-flex;align-items:center;flex:0 0 auto;height:16px;padding:0 5px;border:1px solid var(--pj-border);border-radius:4px;color:var(--pj-text-2);font-size:10.5px;white-space:nowrap}',
      '.dsh-proj-auto{flex:0 0 auto;color:var(--pj-text-3);font-size:10.5px}',
      '.dsh-proj-card-time{margin-left:auto;color:var(--pj-text-3);font-size:10.5px;white-space:nowrap}',
      '.dsh-proj-card-title{font-size:12.5px;font-weight:500;line-height:1.45;word-break:break-word}',
      '.dsh-proj-card-detail{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--pj-text-2);font-size:11.5px;line-height:1.5;word-break:break-word}',
      '.dsh-proj-card-feedback{padding-left:6px;border-left:2px solid var(--pj-blue-border);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--pj-text-2);font-size:11.5px;line-height:1.45;word-break:break-word}',
      '.dsh-proj-card-status{color:var(--pj-text-2);font-size:11px;line-height:1.45}',
      '.dsh-proj-card-result{padding-left:6px;border-left:2px solid var(--pj-border-strong);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--pj-text-2);font-size:11.5px;line-height:1.45;word-break:break-word}',
      '.dsh-proj-card-error{color:var(--pj-red);font-size:11.5px;line-height:1.45;word-break:break-word}',
      '.dsh-proj-card-foot{display:flex;align-items:center;gap:6px;margin-top:2px;min-width:0}',
      '.dsh-proj-card-source{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--pj-text-3);font-size:10.5px}',
      '.dsh-proj-card-actions{display:flex;align-items:center;gap:4px;flex:0 0 auto;margin-left:auto}',
      '.dsh-proj-welcome{display:flex;flex:1 1 auto;align-items:flex-start;justify-content:center;overflow-y:auto;padding:48px 24px}',
      '.dsh-proj-welcome-card{display:flex;flex-direction:column;gap:10px;width:min(460px,100%);padding:20px;border:1px solid var(--pj-border);border-radius:8px;background:var(--pj-bg-raise)}',
      '.dsh-proj-welcome-mark{display:inline-flex;color:var(--pj-blue)}',
      '.dsh-proj-welcome-title{margin:0;font-size:15px;font-weight:600}',
      '.dsh-proj-welcome-hint{margin:0;color:var(--pj-text-2);font-size:12.5px;line-height:1.65}',
      '.dsh-proj-welcome-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dsh-proj-overlay{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(17,19,24,.34)}',
      '.dsh-proj-dialog{display:flex;flex-direction:column;gap:14px;width:min(460px,92vw);max-height:86vh;overflow-y:auto;padding:18px 18px 16px;border:1px solid var(--pj-border-strong);border-radius:8px;background:var(--pj-bg-raise);color:var(--pj-text)}',
      '.dsh-proj-dialog--wide{width:min(560px,92vw)}',
      '.dsh-proj-dialog-head{display:flex;align-items:flex-start;gap:10px}',
      '.dsh-proj-dialog-heading{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.dsh-proj-dialog-title{margin:0;font-size:15px;font-weight:600}',
      '.dsh-proj-dialog-hint{margin:0;color:var(--pj-text-2);font-size:12px;line-height:1.6}',
      '.dsh-proj-close{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;margin-left:auto;width:26px;height:26px;padding:0;border:1px solid var(--pj-border);border-radius:6px;background:var(--pj-bg);color:var(--pj-text-2);cursor:pointer}',
      '.dsh-proj-close:hover{background:var(--pj-bg-hover);color:var(--pj-text)}',
      '.dsh-proj-form{display:flex;flex-direction:column;gap:12px}',
      '.dsh-proj-field{display:flex;flex-direction:column;gap:5px}',
      '.dsh-proj-label{color:var(--pj-text);font-size:12px;font-weight:500}',
      '.dsh-proj-hint{color:var(--pj-text-2);font-size:11.5px;line-height:1.5}',
      '.dsh-proj-text-input{box-sizing:border-box;width:100%;height:32px;padding:0 9px;border:1px solid var(--pj-border);border-radius:8px;background:var(--pj-bg);color:inherit;font:inherit;font-size:13px;outline:none}',
      '.dsh-proj-text-input:focus{border-color:var(--pj-blue-border)}',
      '.dsh-proj-text-input::placeholder{color:var(--pj-text-3)}',
      '.dsh-proj-textarea{box-sizing:border-box;width:100%;min-height:88px;padding:8px 9px;border:1px solid var(--pj-border);border-radius:8px;background:var(--pj-bg);color:inherit;font:inherit;font-size:13px;line-height:1.5;resize:vertical;outline:none}',
      '.dsh-proj-textarea:focus{border-color:var(--pj-blue-border)}',
      '.dsh-proj-textarea::placeholder{color:var(--pj-text-3)}',
      '.dsh-proj-codearea{min-height:112px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;resize:vertical}',
      '.dsh-proj-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
      '.dsh-proj-check{display:flex;align-items:flex-start;gap:8px;color:var(--pj-text);font-size:12.5px;line-height:1.5;cursor:pointer}',
      '.dsh-proj-check input{margin:2px 0 0;accent-color:var(--pj-blue)}',
      '.dsh-proj-check-text{display:flex;flex-direction:column;gap:2px}',
    ].join('\n');

    /* ------------------------------------------------------------------ *
     * Dialog shell + shared form building blocks
     * ------------------------------------------------------------------ */

    function useEscapeHandler(onClose) {
      React.useEffect(() => {
        function onKeyDown(event) {
          if (event && event.key === 'Escape') onClose();
        }
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
      }, [onClose]);
    }

    function Dialog(props) {
      useEscapeHandler(props.onClose);
      const className = 'dsh-proj-dialog' + (props.wide ? ' dsh-proj-dialog--wide' : '');
      return h(
        'div',
        {
          className: 'dsh-proj-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) props.onClose();
          },
        },
        h(
          'div',
          { className, role: 'dialog', 'aria-modal': 'true', 'aria-label': props.title },
          h(
            'div',
            { className: 'dsh-proj-dialog-head' },
            h(
              'div',
              { className: 'dsh-proj-dialog-heading' },
              h('h2', { className: 'dsh-proj-dialog-title' }, props.title),
              props.hint ? h('p', { className: 'dsh-proj-dialog-hint' }, props.hint) : null,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-proj-close',
                title: props.t('close'),
                'aria-label': props.t('close'),
                onClick: props.onClose,
              },
              closeGlyph(13),
            ),
          ),
          props.children,
        ),
      );
    }

    function FormField(props) {
      return h(
        'label',
        { className: 'dsh-proj-field' },
        h('span', { className: 'dsh-proj-label' }, props.label),
        props.children,
        props.hint ? h('span', { className: 'dsh-proj-hint' }, props.hint) : null,
      );
    }

    function DialogActions(props) {
      return h(
        'div',
        { className: 'dsh-proj-actions' },
        props.extra || null,
        h(
          'button',
          { type: 'button', className: 'dsh-proj-btn', onClick: props.onCancel },
          props.cancelLabel,
        ),
        h(
          'button',
          {
            type: 'submit',
            className: 'dsh-proj-btn dsh-proj-btn--primary',
            disabled: !!props.busy,
          },
          props.busy ? props.busyLabel : props.submitLabel,
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Create project
     * ------------------------------------------------------------------ */

    function CreateDialog(props) {
      const t = props.t;
      const defaults = props.defaults || {};
      const [name, setName] = React.useState('');
      const [repoPath, setRepoPath] = React.useState(
        typeof defaults.defaultRepoPath === 'string' ? defaults.defaultRepoPath : '',
      );
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');

      const submit = async (event) => {
        if (event) event.preventDefault();
        if (busy) return;
        const trimmedName = name.trim();
        const trimmedRepo = repoPath.trim();
        if (!trimmedName) {
          setError(t('needName'));
          return;
        }
        if (!trimmedRepo) {
          setError(t('needRepo'));
          return;
        }
        setBusy(true);
        setError('');
        const result = await props.post('/create', { name: trimmedName, repoPath: trimmedRepo });
        setBusy(false);
        if (result && result.ok) {
          props.onClose();
          return;
        }
        setError(readError(result, t('networkError')));
      };

      return h(
        Dialog,
        { t, title: t('newTitle'), hint: t('createHint'), onClose: props.onClose },
        h(
          'form',
          { className: 'dsh-proj-form', onSubmit: submit },
          h(
            FormField,
            { label: t('nameLabel') },
            h('input', {
              className: 'dsh-proj-text-input',
              type: 'text',
              value: name,
              maxLength: 80,
              placeholder: t('namePlaceholder'),
              'aria-label': t('nameLabel'),
              onChange: (event) => setName(event.target.value),
            }),
          ),
          h(
            FormField,
            { label: t('repoLabel'), hint: t('repoHint') },
            h('input', {
              className: 'dsh-proj-text-input',
              type: 'text',
              value: repoPath,
              spellCheck: false,
              placeholder: t('repoPlaceholder'),
              'aria-label': t('repoLabel'),
              onChange: (event) => setRepoPath(event.target.value),
            }),
          ),
          error ? h('p', { className: 'dsh-proj-error' }, error) : null,
          h(DialogActions, {
            t,
            cancelLabel: t('cancel'),
            submitLabel: t('create'),
            busyLabel: t('creating'),
            busy,
            onCancel: props.onClose,
          }),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Rename project
     * ------------------------------------------------------------------ */

    function RenameDialog(props) {
      const t = props.t;
      const [name, setName] = React.useState(props.name || '');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');

      const submit = async (event) => {
        if (event) event.preventDefault();
        if (busy) return;
        const trimmed = name.trim();
        if (!trimmed) {
          setError(t('needProjectName'));
          return;
        }
        setBusy(true);
        setError('');
        const result = await props.post('/rename', { projectId: props.projectId, name: trimmed });
        setBusy(false);
        if (result && result.ok) {
          props.onClose();
          return;
        }
        setError(readError(result, t('networkError')));
      };

      return h(
        Dialog,
        { t, title: t('renameTitle'), hint: t('renameHint'), onClose: props.onClose },
        h(
          'form',
          { className: 'dsh-proj-form', onSubmit: submit },
          h(
            FormField,
            { label: t('nameLabel') },
            h('input', {
              className: 'dsh-proj-text-input',
              type: 'text',
              value: name,
              maxLength: 40,
              placeholder: t('namePlaceholder'),
              'aria-label': t('nameLabel'),
              autoFocus: true,
              onChange: (event) => setName(event.target.value),
            }),
          ),
          error ? h('p', { className: 'dsh-proj-error' }, error) : null,
          h(DialogActions, {
            t,
            cancelLabel: t('cancel'),
            submitLabel: t('save'),
            busyLabel: t('saving'),
            busy,
            onCancel: props.onClose,
          }),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Reopen an issue with one line of guidance
     * ------------------------------------------------------------------ */

    function ReopenDialog(props) {
      const t = props.t;
      const [note, setNote] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');

      const submit = async (event) => {
        if (event) event.preventDefault();
        if (busy) return;
        const guidance = note.trim();
        // An old Host does not read `note` and would drop the line without a
        // trace. Refusing here points at the restart instead of losing what
        // the person typed; an empty note still reopens the card on any Host.
        if (guidance && !props.canNote) {
          setError(t('reopenNoteNeedsRestart'));
          return;
        }
        setBusy(true);
        setError('');
        // The note is optional: an empty one only moves the card back to the
        // pending group, where a person can start the next round.
        const result = await props.post('/issue', {
          projectId: props.projectId,
          issueId: props.issueId,
          action: 'reopen',
          note: guidance,
        });
        setBusy(false);
        if (result && result.ok) {
          props.onClose();
          return;
        }
        setError(readError(result, t('networkError')));
      };

      return h(
        Dialog,
        {
          t,
          title: props.title,
          hint: props.canNote ? t('reopenHint') : t('reopenNoteNeedsRestart'),
          onClose: props.onClose,
        },
        h(
          'form',
          { className: 'dsh-proj-form', onSubmit: submit },
          h(
            FormField,
            { label: t('reopenNoteLabel') },
            h('textarea', {
              className: 'dsh-proj-textarea',
              value: note,
              maxLength: 400,
              placeholder: t('reopenNotePlaceholder'),
              'aria-label': t('reopenNoteLabel'),
              autoFocus: true,
              onChange: (event) => setNote(event.target.value),
            }),
          ),
          error ? h('p', { className: 'dsh-proj-error' }, error) : null,
          h(DialogActions, {
            t,
            cancelLabel: t('cancel'),
            submitLabel: t('actionReopen'),
            busyLabel: t('working'),
            busy,
            onCancel: props.onClose,
          }),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Join project
     * ------------------------------------------------------------------ */

    function JoinDialog(props) {
      const t = props.t;
      const [code, setCode] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');

      const submit = async (event) => {
        if (event) event.preventDefault();
        if (busy) return;
        const trimmed = code.trim();
        if (!trimmed) {
          setError(t('needCode'));
          return;
        }
        setBusy(true);
        setError('');
        const result = await props.post('/join', { code: trimmed });
        setBusy(false);
        if (result && result.ok) {
          props.onClose();
          return;
        }
        setError(readError(result, t('networkError')));
      };

      return h(
        Dialog,
        { t, title: t('joinTitle'), hint: t('joinHint'), onClose: props.onClose },
        h(
          'form',
          { className: 'dsh-proj-form', onSubmit: submit },
          h(
            FormField,
            { label: t('codeLabel') },
            h('textarea', {
              className: 'dsh-proj-textarea dsh-proj-codearea',
              value: code,
              spellCheck: false,
              placeholder: t('codePlaceholder'),
              'aria-label': t('codeLabel'),
              onChange: (event) => setCode(event.target.value),
            }),
          ),
          error ? h('p', { className: 'dsh-proj-error' }, error) : null,
          h(DialogActions, {
            t,
            cancelLabel: t('cancel'),
            submitLabel: t('join'),
            busyLabel: t('joining'),
            busy,
            onCancel: props.onClose,
          }),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Invite code
     * ------------------------------------------------------------------ */

    function InviteDialog(props) {
      const t = props.t;
      const [code, setCode] = React.useState('');
      const [busy, setBusy] = React.useState(true);
      const [error, setError] = React.useState('');
      const [attempt, setAttempt] = React.useState(0);
      const [copied, setCopied] = React.useState(false);
      const copyTimer = React.useRef(null);

      React.useEffect(() => {
        let cancelled = false;
        setBusy(true);
        setError('');
        setCode('');
        props
          .post('/invite', { projectId: props.projectId })
          .then((result) => {
            if (cancelled) return;
            setBusy(false);
            if (result && result.ok && typeof result.code === 'string') {
              setCode(result.code);
              return;
            }
            setError(readError(result, t('inviteFailed')));
          });
        return () => {
          cancelled = true;
        };
      }, [attempt, props.projectId, props.post, t]);

      React.useEffect(
        () => () => {
          if (copyTimer.current) clearTimeout(copyTimer.current);
        },
        [],
      );

      const copy = () => {
        if (!code) return;
        copyToClipboard(code)
          .then(() => {
            setCopied(true);
            if (copyTimer.current) clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopied(false), 1800);
          })
          .catch(() => {});
      };

      return h(
        Dialog,
        {
          t,
          title: t('inviteTitle'),
          hint: t('inviteHint'),
          wide: true,
          onClose: props.onClose,
        },
        busy ? h('p', { className: 'dsh-proj-hint' }, t('inviteLoading')) : null,
        error
          ? h(
              'div',
              { className: 'dsh-proj-actions', style: { justifyContent: 'flex-start' } },
              h('p', { className: 'dsh-proj-error' }, error),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-proj-btn dsh-proj-btn--sm',
                  onClick: () => setAttempt((value) => value + 1),
                },
                t('retry'),
              ),
            )
          : null,
        code
          ? h('textarea', {
              className: 'dsh-proj-textarea dsh-proj-codearea',
              readOnly: true,
              value: code,
              'aria-label': t('codeLabel'),
              onFocus: (event) => event.target.select(),
            })
          : null,
        h(
          'div',
          { className: 'dsh-proj-actions' },
          h(
            'button',
            { type: 'button', className: 'dsh-proj-btn', onClick: props.onClose },
            t('close'),
          ),
          code
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-proj-btn dsh-proj-btn--primary',
                  onClick: copy,
                },
                copied ? t('copied') : t('copy'),
              )
            : null,
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Settings
     * ------------------------------------------------------------------ */

    function SettingsDialog(props) {
      const t = props.t;
      const [name, setName] = React.useState(props.meName || '');
      const [autoFix, setAutoFix] = React.useState(!!props.autoFix);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');

      const submit = async (event) => {
        if (event) event.preventDefault();
        if (busy) return;
        const trimmed = name.trim();
        if (!trimmed) {
          setError(t('needMyName'));
          return;
        }
        setBusy(true);
        setError('');
        const result = await props.post('/settings', { myName: trimmed, autoFix });
        setBusy(false);
        if (result && result.ok) {
          props.onClose();
          return;
        }
        setError(readError(result, t('networkError')));
      };

      return h(
        Dialog,
        { t, title: t('settingsTitle'), onClose: props.onClose },
        h(
          'form',
          { className: 'dsh-proj-form', onSubmit: submit },
          h(
            FormField,
            { label: t('myNameLabel') },
            h('input', {
              className: 'dsh-proj-text-input',
              type: 'text',
              value: name,
              maxLength: 40,
              placeholder: t('myNamePlaceholder'),
              'aria-label': t('myNameLabel'),
              onChange: (event) => setName(event.target.value),
            }),
          ),
          h(
            'label',
            { className: 'dsh-proj-check' },
            h('input', {
              type: 'checkbox',
              checked: autoFix,
              onChange: (event) => setAutoFix(event.target.checked),
            }),
            h(
              'span',
              { className: 'dsh-proj-check-text' },
              h('span', null, t('autoFixLabel')),
              h('span', { className: 'dsh-proj-hint' }, t('autoFixHint')),
            ),
          ),
          error ? h('p', { className: 'dsh-proj-error' }, error) : null,
          h(DialogActions, {
            t,
            cancelLabel: t('cancel'),
            submitLabel: t('save'),
            busyLabel: t('saving'),
            busy,
            onCancel: props.onClose,
          }),
        ),
      );
    }

    /* ------------------------------------------------------------------ *
     * Panel
     * ------------------------------------------------------------------ */

    function ProjectsPanel(props) {
      const t = props.t;
      const tf = (key, vars) => fill(t(key), vars);

      const [state, setState] = React.useState(EMPTY_STATE);
      const [loadError, setLoadError] = React.useState('');
      const [streamStatus, setStreamStatus] = React.useState('connecting');
      const [reloadKey, setReloadKey] = React.useState(0);
      const [tab, setTab] = React.useState('discussion');
      const [draft, setDraft] = React.useState('');
      const [replyTo, setReplyTo] = React.useState(null);
      const [sending, setSending] = React.useState(false);
      const [imageBusy, setImageBusy] = React.useState(false);
      const [sendError, setSendError] = React.useState('');
      const [actionError, setActionError] = React.useState('');
      const [selectBusy, setSelectBusy] = React.useState(false);
      const [relayBusy, setRelayBusy] = React.useState(false);
      const [issueBusy, setIssueBusy] = React.useState('');
      const [overlay, setOverlay] = React.useState(null);

      const listRef = React.useRef(null);
      const composerRef = React.useRef(null);

      const applyState = React.useCallback((next) => {
        if (!next || typeof next !== 'object' || next.ok === false) return;
        if (!Array.isArray(next.projects)) return;
        setState(next);
        setLoadError('');
      }, []);

      const post = React.useCallback(
        async (path, body) => {
          try {
            const response = await fetch(API + path, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body || {}),
            });
            const payload = await response.json().catch(() => null);
            if (payload && payload.state) applyState(payload.state);
            if (!payload || typeof payload !== 'object') return { ok: false, error: '' };
            return payload;
          } catch (err) {
            return { ok: false, error: '' };
          }
        },
        [applyState],
      );

      // One snapshot, then the live stream. reloadKey recreates the stream and
      // refetches the snapshot when the user asks to reconnect or retries.
      React.useEffect(() => {
        let disposed = false;
        setStreamStatus('connecting');
        setLoadError('');

        fetch(API + '/state', { headers: { Accept: 'application/json' }, cache: 'no-store' })
          .then((response) => response.json())
          .then((payload) => {
            if (disposed) return;
            if (payload && Array.isArray(payload.projects)) applyState(payload);
            else setLoadError(t('loadError'));
          })
          .catch(() => {
            if (!disposed) setLoadError(t('loadError'));
          });

        let source = null;
        if (typeof window !== 'undefined' && typeof window.EventSource === 'function') {
          try {
            source = new window.EventSource(API + '/events');
            source.onopen = () => {
              if (!disposed) setStreamStatus('online');
            };
            source.onerror = () => {
              if (!disposed) setStreamStatus('offline');
            };
            // CONTRACT §4: data: {"type":"state","state":State}. Accept a
            // named 'state' event and a bare State body as well, so a Host
            // that changes only the framing keeps working.
            const applyFrame = (event) => {
              if (disposed) return;
              try {
                const payload = JSON.parse(event.data);
                if (payload && payload.type === 'state' && payload.state) {
                  applyState(payload.state);
                } else if (payload && Array.isArray(payload.projects)) {
                  applyState(payload);
                }
              } catch (err) {
                /* ignore a torn frame; the next snapshot is complete */
              }
            };
            source.onmessage = applyFrame;
            source.addEventListener('state', applyFrame);
          } catch (err) {
            setStreamStatus('offline');
          }
        } else {
          setStreamStatus('offline');
        }

        return () => {
          disposed = true;
          if (source) source.close();
        };
      }, [applyState, reloadKey, t]);

      const projects = state ? asArray(state.projects) : [];
      const activeId = state && typeof state.activeId === 'string' ? state.activeId : '';
      const active = projects.find((project) => project && project.id === activeId) || null;
      const me = state && state.me && typeof state.me === 'object' ? state.me : { name: '' };
      const messages = active ? asArray(active.messages) : [];
      const lastMessageId = messages.length ? messages[messages.length - 1].id : '';

      // The Host half only reloads when the app restarts, while this module
      // reloads with the page: a refreshed panel can run ahead of its Host and
      // then has no /image route to upload to. `capabilities` tells the two
      // apart, so the paste path can name the restart instead of failing after
      // sending the bytes.
      const canSendImage = Boolean(state && state.capabilities && state.capabilities.image);
      // Same version split for the reopen note: the Host stores it as
      // `issue.feedback` and feeds it to the next Worker. An old Host silently
      // ignores `note`, so ask before typing instead of losing the line.
      const canReopenNote = Boolean(state && state.capabilities && state.capabilities.reopenNote);

      // Switching projects never carries a draft or a quote across; each project
      // resumes its own draft, which also survives leaving and re-entering the
      // panel (see DRAFT_STORE).
      const previousActive = React.useRef(activeId);
      React.useEffect(() => {
        if (previousActive.current === activeId) return;
        previousActive.current = activeId;
        setDraft(readDraft(activeId));
        setReplyTo(null);
        setSendError('');
        setActionError('');
      }, [activeId]);

      React.useEffect(() => {
        if (tab !== 'discussion') return;
        const element = listRef.current;
        if (element) element.scrollTop = element.scrollHeight;
      }, [activeId, tab, lastMessageId]);

      const selectProject = async (projectId) => {
        if (!projectId || projectId === activeId || selectBusy) return;
        setSelectBusy(true);
        setActionError('');
        const result = await post('/select', { projectId });
        setSelectBusy(false);
        if (!result || !result.ok) setActionError(readError(result, t('selectFailed')));
      };

      const reconnectRelay = async () => {
        if (!active || relayBusy) return;
        setRelayBusy(true);
        setActionError('');
        const result = await post('/relay', { projectId: active.id });
        setRelayBusy(false);
        if (!result || !result.ok) setActionError(readError(result, t('relayReconnectFailed')));
      };

      const handleSend = async () => {
        if (!active || sending) return;
        const text = draft.trim();
        if (!text) return;
        setSending(true);
        setSendError('');
        const body = { projectId: active.id, text };
        if (replyTo && replyTo.id) body.replyTo = replyTo.id;
        const result = await post('/send', body);
        setSending(false);
        if (result && result.ok) {
          setDraft('');
          writeDraft(active.id, '');
          setReplyTo(null);
          return;
        }
        // Keep the draft: on failure the user retries without retyping.
        setSendError(tf('sendFailedWith', { reason: readError(result, t('networkError')) }));
      };

      /**
       * Sends one picture into the open discussion. The bytes go to the Host
       * as a raw body; the event itself only carries the description, and the
       * Host hands the bytes to the relay as an attachment.
       */
      const sendPicture = async (file) => {
        const targetId = activeId;
        if (!file || !targetId || imageBusy) return;
        const type = typeof file.type === 'string' ? file.type : '';
        if (type.indexOf('image/') !== 0) {
          setSendError(t('attachFailed'));
          return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setSendError(t('imageTooLarge'));
          return;
        }
        if (!canSendImage) {
          setSendError(t('imageNeedsRestart'));
          return;
        }
        setSendError('');
        setImageBusy(true);
        try {
          const prepared = await prepareImage(file);
          const query =
            '?id=' +
            encodeURIComponent(targetId) +
            '&name=' +
            encodeURIComponent(prepared.name || 'image') +
            (replyTo && replyTo.id ? '&replyTo=' + encodeURIComponent(replyTo.id) : '');
          const response = await fetch(API + '/image' + query, {
            method: 'POST',
            headers: { 'Content-Type': prepared.type || 'application/octet-stream' },
            body: prepared.blob,
          });
          const payload = await response.json().catch(() => null);
          if (payload && payload.state) applyState(payload.state);
          if (!payload || !payload.ok) {
            setSendError(readError(payload, t('attachFailed')));
          } else {
            setReplyTo(null);
          }
        } catch (err) {
          setSendError(t('attachFailed'));
        }
        setImageBusy(false);
      };

      /**
       * A pasted picture is sent straight away: copying a screenshot and
       * pasting it here is the whole gesture. Text pastes are left alone.
       */
      const handlePaste = (event) => {
        const data = event.clipboardData || (event.nativeEvent && event.nativeEvent.clipboardData);
        const file = pickPastedImage(data ? data.items : null);
        if (!file) return;
        event.preventDefault();
        void sendPicture(file);
      };

      const runIssueAction = async (issue, action) => {
        if (!active || !issue || issueBusy) return;
        setIssueBusy(issue.id + ':' + action);
        setActionError('');
        const result = await post('/issue', {
          projectId: active.id,
          issueId: issue.id,
          action,
        });
        setIssueBusy('');
        if (!result || !result.ok) setActionError(readError(result, t('actionFailed')));
      };

      // Reopening asks for a line of guidance first: the card is usually sent
      // back because the fix missed details, and the next Worker round needs
      // that context. The dialog keeps the quick path (blank note) available.
      const openReopenDialog = (issue) => {
        if (!active || !issue || issueBusy) return;
        setActionError('');
        setOverlay({ kind: 'reopen', issueId: issue.id });
      };

      const startReply = (message) => {
        if (!message) return;
        const actor = message.actor || {};
        setReplyTo({
          id: message.id,
          name: actor.name || t('unknown'),
          text: message.text ? truncate(message.text, 60) : message.image ? t('imageBadge') : '',
        });
        setSendError('');
        const element = composerRef.current;
        if (element && typeof element.focus === 'function') element.focus();
      };

      /* ------------------------------------------------------------ *
       * Discussion
       * ------------------------------------------------------------ */

      const renderNotice = (message) => {
        const type = resolveIssueType(active, message);
        return h(
          'div',
          { key: message.id, className: 'dsh-proj-notice' },
          h('span', { className: 'dsh-proj-notice-line' }),
          h(
            'span',
            { className: 'dsh-proj-notice-text' },
            type ? h('span', { className: 'dsh-proj-type', 'data-type': type }, issueTypeLabel(type, t)) : null,
            h('span', null, message.text || ''),
          ),
          h('span', { className: 'dsh-proj-notice-line' }),
        );
      };

      const renderMessage = (message) => {
        const actor = message.actor || {};
        if (isNoticeMessage(message)) return renderNotice(message);
        const mine = isSelfActor(active, actor, me);
        const agent = actor.kind === 'agent';
        const quote = replyPreviewFor(active, message);
        return h(
          'div',
          {
            key: message.id,
            className: 'dsh-proj-msg',
            'data-mine': mine ? 'true' : 'false',
            'data-agent': agent ? 'true' : 'false',
          },
          h(
            'div',
            { className: 'dsh-proj-msg-head' },
            !mine && !agent
              ? h('span', { className: 'dsh-proj-avatar', 'aria-hidden': true }, initial(actor.name))
              : null,
            agent
              ? h('span', { className: 'dsh-proj-agent-tag' }, t('assistantName'))
              : h(
                  'span',
                  { className: 'dsh-proj-msg-name' },
                  mine ? t('you') : actor.name || t('unknown'),
                ),
            h('span', { className: 'dsh-proj-msg-time' }, shortTime(message.at)),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-proj-replybtn',
                onClick: () => startReply(message),
              },
              t('reply'),
            ),
          ),
          h(
            'div',
            { className: 'dsh-proj-bubble' },
            quote ? h('div', { className: 'dsh-proj-quote' }, quote) : null,
            renderMessageImage(message),
            message.text ? h('span', null, message.text) : null,
          ),
        );
      };

      /** The picture of one message; shows a hint until the Host has the bytes. */
      const renderMessageImage = (message) => {
        if (!message.image) return null;
        if (message.image.ready === false) {
          return h('span', { className: 'dsh-proj-image-pending' }, t('imageLoading'));
        }
        const src = API + '/image?id=' + encodeURIComponent(message.id) + '&v=' + (message.at || 0);
        return h('img', {
          className: 'dsh-proj-image',
          src,
          alt: message.image.name || t('imageBadge'),
          loading: 'lazy',
          onClick: () => {
            try {
              window.open(API + '/image?id=' + encodeURIComponent(message.id), '_blank');
            } catch (err) {
              /* a blocked popup is harmless */
            }
          },
        });
      };

      const renderDiscussion = () =>
        h(
          'div',
          { className: 'dsh-proj-discussion' },
          h(
            'div',
            { className: 'dsh-proj-scroll', ref: listRef },
            messages.length === 0
              ? h(
                  'div',
                  { className: 'dsh-proj-empty' },
                  h('p', { className: 'dsh-proj-empty-title' }, t('noMessages')),
                  h('p', { className: 'dsh-proj-empty-hint' }, t('noMessagesHint')),
                )
              : messages.map(renderMessage),
          ),
          h(
            'div',
            { className: 'dsh-proj-composer' },
            replyTo
              ? h(
                  'div',
                  { className: 'dsh-proj-quotebar' },
                  h('span', { className: 'dsh-proj-quote-name' }, replyTo.name),
                  h('span', { className: 'dsh-proj-quote-body' }, replyTo.text),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-proj-replybtn',
                      onClick: () => setReplyTo(null),
                      title: t('cancelReply'),
                      'aria-label': t('cancelReply'),
                    },
                    t('cancel'),
                  ),
                )
              : null,
            h(
              'div',
              { className: 'dsh-proj-composer-row' },
              h('textarea', {
                ref: composerRef,
                className: 'dsh-proj-input',
                value: draft,
                rows: 2,
                placeholder: t('composerPlaceholder'),
                'aria-label': t('composerPlaceholder'),
                onChange: (event) => {
                  setDraft(event.target.value);
                  writeDraft(active.id, event.target.value);
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void handleSend();
                  }
                },
                onPaste: handlePaste,
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-proj-btn dsh-proj-btn--primary',
                  disabled: sending || !draft.trim(),
                  onClick: () => void handleSend(),
                },
                sending ? t('sending') : t('send'),
              ),
            ),
            imageBusy ? h('p', { className: 'dsh-proj-hint' }, t('imageSending')) : null,
            sendError ? h('p', { className: 'dsh-proj-error' }, sendError) : null,
          ),
        );

      /* ------------------------------------------------------------ *
       * Board
       * ------------------------------------------------------------ */

      const renderIssue = (issue) => {
        const status = issue.status;
        const actions = [];
        const actionButton = (label, action, accent, onClick) =>
          h(
            'button',
            {
              key: action,
              type: 'button',
              className:
                'dsh-proj-btn dsh-proj-btn--sm' + (accent ? ' dsh-proj-btn--accent' : ''),
              disabled: !!issueBusy,
              onClick: onClick || (() => void runIssueAction(issue, action)),
            },
            issueBusy === issue.id + ':' + action ? t('working') : label,
          );

        if (status === 'triage' || status === 'open') {
          actions.push(actionButton(t('actionFix'), 'fix', true));
          actions.push(actionButton(t('actionDismiss'), 'dismiss', false));
        } else if (status === 'review') {
          actions.push(actionButton(t('actionDone'), 'done', true));
          actions.push(actionButton(t('actionReopen'), 'reopen', false, () => openReopenDialog(issue)));
        } else if (status === 'done' || status === 'dismissed') {
          actions.push(actionButton(t('actionReopen'), 'reopen', false, () => openReopenDialog(issue)));
        }

        const archived = status === 'done' || status === 'dismissed';
        const fixing = status === 'fixing';
        const workerStatus =
          issue.worker && typeof issue.worker === 'object' ? issue.worker.status : '';
        const fixingText = workerStatus === 'error' ? t('assistantError') : t('assistantWorking');
        const resultSummary =
          issue.result && typeof issue.result === 'object' && typeof issue.result.summary === 'string'
            ? issue.result.summary
            : '';

        return h(
          'div',
          { key: issue.id, className: 'dsh-proj-card' },
          h(
            'div',
            { className: 'dsh-proj-card-head' },
            h(
              'span',
              {
                className: 'dsh-proj-type',
                'data-type': issue.type === 'bug' ? 'bug' : 'experience',
              },
              issueTypeLabel(issue.type, t) || t('typeExperience'),
            ),
            issue.auto ? h('span', { className: 'dsh-proj-auto' }, t('auto')) : null,
            archived
              ? h('span', { className: 'dsh-proj-chip' }, issueStatusLabel(status, t))
              : null,
            h(
              'span',
              { className: 'dsh-proj-card-time' },
              shortTime(issue.updatedAt || issue.createdAt),
            ),
          ),
          h('div', { className: 'dsh-proj-card-title' }, issue.title || ''),
          issue.detail ? h('div', { className: 'dsh-proj-card-detail' }, issue.detail) : null,
          issue.feedback
            ? h(
                'div',
                { className: 'dsh-proj-card-feedback' },
                tf('reopenNoteView', { note: issue.feedback }),
              )
            : null,
          fixing ? h('div', { className: 'dsh-proj-card-status' }, fixingText) : null,
          resultSummary ? h('div', { className: 'dsh-proj-card-result' }, resultSummary) : null,
          issue.error ? h('div', { className: 'dsh-proj-card-error' }, issue.error) : null,
          h(
            'div',
            { className: 'dsh-proj-card-foot' },
            h(
              'span',
              { className: 'dsh-proj-card-source' },
              tf('sourceFrom', { name: issue.sourceActorName || t('unknown') }),
            ),
            actions.length ? h('div', { className: 'dsh-proj-card-actions' }, actions) : null,
          ),
        );
      };

      const renderBoard = () => {
        const issues = active ? asArray(active.issues) : [];
        const groups = [
          { key: 'pending', title: t('groupPending'), statuses: STATUS_PENDING },
          { key: 'fixing', title: t('groupFixing'), statuses: ['fixing'] },
          { key: 'review', title: t('groupReview'), statuses: ['review'] },
          { key: 'archive', title: t('groupArchive'), statuses: STATUS_ARCHIVE },
        ];

        if (!issues.length) {
          return h(
            'div',
            { className: 'dsh-proj-board' },
            h(
              'div',
              { className: 'dsh-proj-board-empty' },
              h('p', { className: 'dsh-proj-empty-title' }, t('noIssuesTitle')),
              h('p', { className: 'dsh-proj-empty-hint' }, t('noIssuesHint')),
            ),
          );
        }

        return h(
          'div',
          { className: 'dsh-proj-board' },
          groups.map((group) => {
            const items = issues.filter(
              (issue) => issue && group.statuses.indexOf(issue.status) >= 0,
            );
            return h(
              'div',
              { key: group.key, className: 'dsh-proj-group' },
              h(
                'div',
                { className: 'dsh-proj-group-head' },
                h('span', { className: 'dsh-proj-group-title' }, group.title),
                h('span', { className: 'dsh-proj-group-count' }, String(items.length)),
              ),
              items.length === 0
                ? h('div', { className: 'dsh-proj-group-empty' }, t('groupEmpty'))
                : items.map(renderIssue),
            );
          }),
        );
      };

      /* ------------------------------------------------------------ *
       * Chrome: rail, top bar, welcome states
       * ------------------------------------------------------------ */

      const openOverlay = (kind) => {
        setActionError('');
        setOverlay({ kind });
      };

      const rail = h(
        'aside',
        { className: 'dsh-proj-rail', 'aria-label': t('title') },
        h(
          'div',
          { className: 'dsh-proj-rail-head' },
          h('h1', { className: 'dsh-proj-rail-title' }, t('title')),
          h('span', { className: 'dsh-proj-rail-count' }, tf('projectCount', { n: projects.length })),
        ),
        h(
          'div',
          { className: 'dsh-proj-rail-list' },
          projects.length === 0
            ? h('div', { className: 'dsh-proj-rail-empty' }, t('noProjectsRail'))
            : projects.map((project) => {
                const pending = issueCount(project, STATUS_PENDING);
                return h(
                  'button',
                  {
                    key: project.id,
                    type: 'button',
                    className: 'dsh-proj-rail-item',
                    'data-active': project.id === activeId ? 'true' : 'false',
                    onClick: () => void selectProject(project.id),
                    title: project.name || t('untitledProject'),
                  },
                  h(
                    'span',
                    { className: 'dsh-proj-rail-name' },
                    project.name || t('untitledProject'),
                  ),
                  pending > 0
                    ? h(
                        'span',
                        { className: 'dsh-proj-rail-badge', title: t('groupPending') },
                        String(pending),
                      )
                    : null,
                );
              }),
        ),
        h(
          'div',
          { className: 'dsh-proj-rail-foot' },
          h(
            'button',
            { type: 'button', className: 'dsh-proj-btn dsh-proj-btn--sm', onClick: () => openOverlay('create') },
            t('newProject'),
          ),
          h(
            'button',
            { type: 'button', className: 'dsh-proj-btn dsh-proj-btn--sm', onClick: () => openOverlay('join') },
            t('joinProject'),
          ),
        ),
      );

      // action: 'project' shows the create/join pair, 'retry' shows a reload.
      const welcome = (title, hint, action) => {
        let actions = null;
        if (action === 'project') {
          actions = h(
            'div',
            { className: 'dsh-proj-welcome-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-proj-btn dsh-proj-btn--primary',
                onClick: () => openOverlay('create'),
              },
              t('newProject'),
            ),
            h(
              'button',
              { type: 'button', className: 'dsh-proj-btn', onClick: () => openOverlay('join') },
              t('joinProject'),
            ),
          );
        } else if (action === 'retry') {
          actions = h(
            'div',
            { className: 'dsh-proj-welcome-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-proj-btn',
                onClick: () => {
                  setLoadError('');
                  setReloadKey((value) => value + 1);
                },
              },
              t('retry'),
            ),
          );
        }
        return h(
          'div',
          { className: 'dsh-proj-welcome' },
          h(
            'div',
            { className: 'dsh-proj-welcome-card' },
            h('span', { className: 'dsh-proj-welcome-mark' }, projectsGlyph(22)),
            h('h2', { className: 'dsh-proj-welcome-title' }, title),
            hint ? h('p', { className: 'dsh-proj-welcome-hint' }, hint) : null,
            actions,
          ),
        );
      };

      const topBar = (project) => {
        const members = asArray(project.members);
        const relayStatus = project.relayStatus || 'idle';
        const relayError = typeof project.relayError === 'string' ? project.relayError : '';
        const relayTitle = relayError || relayLabel(relayStatus, t);
        const memberNames = members
          .map((member) => (member && member.name ? member.name : ''))
          .filter(Boolean)
          .join(' · ');
        return h(
          'header',
          { className: 'dsh-proj-top' },
          h(
            'div',
            { className: 'dsh-proj-top-title' },
            h(
              'div',
              { className: 'dsh-proj-top-namerow' },
              h(
                'h2',
                { className: 'dsh-proj-top-name' },
                project.name || t('untitledProject'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-proj-top-rename',
                  title: t('rename'),
                  'aria-label': t('rename'),
                  onClick: () => openOverlay('rename'),
                },
                pencilGlyph(13),
              ),
            ),
            h(
              'div',
              { className: 'dsh-proj-top-sub' },
              h(
                'span',
                { title: memberNames || undefined },
                tf('memberCount', { n: members.length }),
              ),
              h('span', { className: 'dsh-proj-dot', 'data-status': relayStatus, title: relayTitle }),
              h('span', { title: relayTitle }, relayLabel(relayStatus, t)),
              relayStatus === 'error'
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-proj-link',
                      disabled: relayBusy,
                      onClick: () => void reconnectRelay(),
                    },
                    relayBusy ? t('relayConnecting') : t('reconnectRelay'),
                  )
                : null,
            ),
          ),
          h(
            'div',
            { className: 'dsh-proj-top-actions' },
            h(
              'button',
              { type: 'button', className: 'dsh-proj-btn', onClick: () => openOverlay('invite') },
              t('invite'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-proj-btn dsh-proj-btn--icon dsh-proj-btn--ghost',
                title: t('settings'),
                'aria-label': t('settings'),
                onClick: () => openOverlay('settings'),
              },
              gearGlyph(15),
            ),
          ),
        );
      };

      const streamBar =
        streamStatus === 'offline'
          ? h(
              'div',
              { className: 'dsh-proj-streambar' },
              h('span', { className: 'dsh-proj-dot', 'data-status': 'offline' }),
              h('span', { className: 'dsh-proj-stream-text' }, t('streamLost')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-proj-link',
                  onClick: () => {
                    setStreamStatus('connecting');
                    setReloadKey((value) => value + 1);
                  },
                },
                t('reconnect'),
              ),
            )
          : null;

      const retryBar = loadError
        ? h(
            'div',
            { className: 'dsh-proj-streambar' },
            h('span', { className: 'dsh-proj-stream-text' }, loadError),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-proj-link',
                onClick: () => {
                  setLoadError('');
                  setReloadKey((value) => value + 1);
                },
              },
              t('retry'),
            ),
          )
        : null;

      const actionBar = actionError
        ? h(
            'div',
            { className: 'dsh-proj-errorbar' },
            h('span', { className: 'dsh-proj-stream-text' }, actionError),
            h(
              'button',
              { type: 'button', className: 'dsh-proj-link', onClick: () => setActionError('') },
              t('close'),
            ),
          )
        : null;

      const pendingCount = active ? issueCount(active, STATUS_PENDING) : 0;

      const tabs = h(
        'div',
        { className: 'dsh-proj-tabs', role: 'tablist' },
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            className: 'dsh-proj-tab',
            'data-active': tab === 'discussion' ? 'true' : 'false',
            'aria-selected': tab === 'discussion' ? 'true' : 'false',
            onClick: () => setTab('discussion'),
          },
          t('tabDiscussion'),
        ),
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            className: 'dsh-proj-tab',
            'data-active': tab === 'board' ? 'true' : 'false',
            'aria-selected': tab === 'board' ? 'true' : 'false',
            onClick: () => setTab('board'),
          },
          t('tabBoard'),
          pendingCount > 0
            ? h('span', { className: 'dsh-proj-tab-count' }, String(pendingCount))
            : null,
        ),
      );

      let main;
      if (loadError && !state) {
        main = welcome(t('loadError'), '', 'retry');
      } else if (!state) {
        main = welcome(t('loading'), '', null);
      } else if (projects.length === 0) {
        main = welcome(t('noProjectsTitle'), t('noProjectsHint'), 'project');
      } else if (!active) {
        main = welcome(t('pickProjectTitle'), t('pickProjectHint'), 'project');
      } else {
        main = h(
          'div',
          { className: 'dsh-proj-main' },
          topBar(active),
          streamBar,
          loadError ? retryBar : null,
          actionBar,
          tabs,
          tab === 'discussion' ? renderDiscussion() : renderBoard(),
        );
      }

      const renderOverlay = () => {
        if (!overlay) return null;
        const close = () => setOverlay(null);
        if (overlay.kind === 'create') {
          return h(CreateDialog, {
            t,
            post,
            defaults: state && state.defaults ? state.defaults : {},
            onClose: close,
          });
        }
        if (overlay.kind === 'join') {
          return h(JoinDialog, { t, post, onClose: close });
        }
        if (overlay.kind === 'rename') {
          if (!active) return null;
          return h(RenameDialog, {
            t,
            post,
            projectId: active.id,
            name: active.name || '',
            onClose: close,
          });
        }
        if (overlay.kind === 'invite') {
          if (!active) return null;
          return h(InviteDialog, { t, post, projectId: active.id, onClose: close });
        }
        if (overlay.kind === 'reopen') {
          if (!active) return null;
          const issue = asArray(active.issues).find((entry) => entry && entry.id === overlay.issueId);
          if (!issue) return null;
          return h(ReopenDialog, {
            t,
            post,
            canNote: canReopenNote,
            projectId: active.id,
            issueId: issue.id,
            title: tf('reopenTitleFor', { title: issue.title || t('unknown') }),
            onClose: close,
          });
        }
        if (overlay.kind === 'settings') {
          return h(SettingsDialog, {
            t,
            post,
            meName: me.name || '',
            autoFix: !!(state && state.autoFix),
            onClose: close,
          });
        }
        return null;
      };

      return h(
        'div',
        { className: 'dsh-proj-root' },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        rail,
        main,
        renderOverlay(),
      );
    }

    /* ------------------------------------------------------------------ *
     * Plugin
     * ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);

        ctx.effect(() => {
          const disposers = [];
          const ids = new Set(['en', 'zh', 'zh-Hans', 'zh-CN', 'zh-TW']);
          try {
            for (const locale of ctx.locale.getSnapshot().locales) ids.add(locale.id);
          } catch (err) {
            /* keep the shipped tags */
          }
          for (const id of ids) {
            const dict = String(id).toLowerCase().indexOf('zh') === 0 ? DICTS.zh : DICTS.en;
            try {
              disposers.push(ctx.locale.register(NS, id, dict));
            } catch (err) {
              /* already registered */
            }
          }
          return () => {
            for (const dispose of disposers.reverse()) {
              try {
                dispose();
              } catch (err) {
                /* ignore */
              }
            }
          };
        }, 'projects-locale');

        const View = (slotProps) =>
          h(ProjectsPanel, Object.assign({}, slotProps, { t, locale: ctx.locale }));

        const PanelIcon = (slotProps) => h(ProjectsIcon, slotProps);

        // Register the main key first: the sidebar button only navigates to a
        // key that already exists.
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, View),
        );

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: PANEL_ORDER,
              label: () => t('title'),
            },
            PanelIcon,
          ),
        );
      },
    };
  },
});
