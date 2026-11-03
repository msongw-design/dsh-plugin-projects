# Projects plugin

A **Projects** panel in the DSH sidebar: invite teammates into a project, talk it over, and the defects and UX gaps mentioned in the discussion become issue cards that a local Agent reproduces and fixes, then replies in the thread.

This is a lightweight, in-editor take on the "event-driven + two-stage triage + worker execution" chain from the [Super-agent design exploration](https://github.com/deepseek-ai/dsh-superagent-prototype). The event source is not GitHub or Feishu — it is the project's own discussion.

## What it does

- **Invite members**: create a project (bound to a repository directory on this machine) → get an invite code → the other side installs the same plugin and pastes the code. Discussions sync in real time over the public ntfy relay: no server, no public IP.
- **Rename**: hover the pencil beside the project name; only the display name changes, and other members pick up the `project.renamed` event.
- **Talk freely**: messages are grouped by side with quote replies; screenshots can be pasted straight into the composer (sent as image messages, bytes over the relay with a local copy kept); system notices (detected, fixing, failed) render as centered hairline rows; the Agent's result comes back as a "project assistant" bubble.
- **Auto-triage**: every human message first runs through program rules (the fast path); only a defect or UX complaint becomes a card. Low confidence parks it in **to confirm**; high confidence with auto-fix on goes straight to **to fix**.
- **Run the fix**: the worker opens an independent DSH session inside the project's repository, reproduces the issue, makes the smallest fix, runs the tests, and replies with conclusion / root cause / change / verification. The card moves to **to verify**.
- **Kanban**: four columns — pending, fixing, to verify, done/dismissed. Pending cards offer Fix or Ignore; to-verify cards offer Mark done or Reopen.

## Install

In the left sidebar open **Plugins → Add plugin**, paste `https://github.com/msongw-design/dsh-plugin-projects` (or the absolute path of a local clone), enable it under **Installed**, then reload the page. The Host half loads only at startup, so the first install needs a DSH restart.

## Use

1. Make sure **Projects** is enabled; the sidebar shows a Projects entry.
2. Open **Projects → New project**: give it a name and the absolute path of the repository.
3. **Invite** in the top right copies an invite code; send it over. The other side uses **Join project** and pastes it.
4. Just talk in the discussion. For example:

   > Login does nothing when I click it, always errors, reproduces every time

   Seconds later a defect card and a "reproduce and fix" notice appear; when the worker finishes, the project assistant replies with the conclusion.
5. Accept work in the kanban: **Mark done** or **Reopen**.

## How auto-fix runs

- Trigger: a high-confidence hit (score ≥ 3.5) with auto-fix enabled, or a manual **Fix** click.
- Steps: `ctx.agents.create()` opens a session in the project repository → permission set to `danger-full-access` → the fix prompt is injected → the run completes → the last assistant reply is read from the session events as the summary.
- One worker per project at a time; other cards stay pending. A failed worker returns its card to pending with the reason spelled out (for example, missing model credentials).
- Fixes only touch the local working copy: nothing is committed or pushed. After you accept, it is your call whether to commit.

## Compatibility

Developed and verified against **DSH 0.2.1-rc.5** (macOS desktop profile). The plugin is one bundle row: the Host half (`index.js`) owns relay subscriptions, the event log, triage and workers; the browser half (`client.js`) registers the sidebar entry and the main panel; `protocol.js` holds the pure functions both sides share (envelopes, invite codes, folding, triage rules, the state machine).

Cross-machine collaboration rides the public **ntfy** relay (`https://ntfy.sh`): no server or public IP needed, subject to its quotas (see Limits).

## Limits

- **Shared working copy**: each member fixes on their own machine with no worktree isolation; when several people press Fix at once, each edits their own copy.
- **Relay quotas**: the public ntfy relay allows about 4 KB per text message, roughly 250 messages per day per egress IP, and 12 hours of cache. Images do not use the 4 KB text limit — they upload as ntfy attachments (this plugin caps them at 4 MB), and the receiver writes them to disk immediately so they survive attachment expiry. Self-host ntfy and swap the relay in the project data to escape the quotas.
- **Triage is rules, not a model**: the fast path uses keywords and reproduction phrases; false positives are dismissed with Ignore, misses are covered by pressing Fix manually. The slow path backstops with the worker's reproduction.
- **Data is local**: `$DSH_HOME/plugin-data/projects/` (state, one event log per project, `images/`). History is not back-filled from the peer after switching machines or clearing caches.

## Development

- Layout: `protocol.js` (pure functions: envelopes, invite codes, folding, triage rules, state machine), `index.js` (Host: relay subscription, log, triage, worker, HTTP/SSE), `client.js` (browser panel), `test/`.
- Tests need Node ≥ 22; if `node` is not on PATH use the one bundled with DSH:

  ```sh
  node --test test/*.test.mjs
  ```

  37 cases cover triage rules, invite-code round trips, envelope field filtering, folding, status transitions, project rename, two-instance relay sync (including image attachments landing on disk), capability bits, failure fallback, and input edges. Host tests use an in-process fake relay and never touch the network.
- Scope: changing `client.js` takes effect on reload; changing `index.js` or `protocol.js` needs a DSH restart (the Host half loads at startup only). When the two versions diverge, the client reads `capabilities` from State and asks for a restart instead of failing the upload.
- Install into a profile for development: `dsh plugin --profile <name> add "link:<this directory>"`, add `dsh-plugin-projects` to the profile's `dsh.profile.bundles`, and restart DSH.

## License

[MIT](LICENSE)
