# Changelog — channels lane

Every `@copilotkit/channels*` package listed under `scopes.channels` in
`release.config.json`. They share one version.

`release / create-pr` prepends a section here for each release, and
`release / publish` reads the newest section back as the GitHub Release body.
To change what ships, edit the section on the release PR branch before merging.

Entries begin with the first release cut after this file was added. The lane had
no changelog before that.

## 0.13.0 - 2026-11-23

This release improves the reliability of approval resumes and interactive pickers across multiple processes and replicas. It also improves resilience when Intelligence thread history fails to replay.

## Breaking Changes

### Approval resume now defaults to the run initiator (#8118)

Approval resume is now scoped to the person who started the workflow by default. Applications that rely on conversation-wide approvals must opt into that scope explicitly.

**Migration:**

- For team approvals that anyone in the conversation should be able to resume, set `answerableBy: "conversation"` explicitly.
- Handlers can call `thread.assertCanResume()` to check access before updating a card; resume still re-checks access and claims its gate.
- See the channels migration guide for the matching preflight and resume options.

## Fixes

### Durable, cross-process approvals and pickers (#8118)

- Resume gates are now resolved once per bind and stamped on every action the bind writes, so a stale bind can no longer reopen a gate that a newer bind has already claimed and allow a leg to resume twice.
- A superseded bind now waits for the current gate rather than creating a fresh one, and fails closed if the newer write has failed.
- Isolated MemoryStore deduplication state from application KV, so dedup bookkeeping no longer collides with application data.

### Choice picker fixes

- Fixes approval state handling in choice pickers.

### Intelligence runner durability and replay (#7826)

- **Slow but healthy gateways no longer time out runs.** The 60s durability deadline now counts from the last durable progress (queue becoming non-empty or the last acknowledged batch) rather than from when the oldest pending event was queued. A gateway that stops acknowledging still fails the run after 60s.
- **Bounded pending-event queue.** A run may now hold at most `maxPendingEvents` (default 50,000) unacknowledged events; the next event fails the run with `RunnerEventQueueFullError` and aborts the agent.
- **Lower memory on long runs.** The runner no longer retains every event of a run in memory, using an incremental finalizer and a `RUN_ERROR` flag instead.
- **Replay failures now settle live runs.** On `replay_failed`, a live run fails with a typed `IntelligenceReplayFailedError` (`code: "INTELLIGENCE_REPLAY_FAILED"`) carrying the thread and run ids, instead of leaving `runAgent` hanging and the chat busy.
- **Replayed errors are distinguishable from live ones.** `AGENT_RUN_ERROR_EVENT` context now carries a `phase` of `"replay"`, `"live"`, or `"unknown"`, so apps no longer show a stale error from replayed history after a newer run has succeeded.
- **Reconnect cursor is restored on a failed replay**, so the next connect asks for the history the failed replay never delivered, and the error names the canonical run even when refreshed credentials omit the run ID.
- New `onEventDeliveryStats` option reports acknowledgement latency, pending event count, and oldest-event age per batch, so deployments can watch the queue back up before a run times out.
- Fell back to sorting runner events if they are ever queued out of sequence order, logging once instead of sending them out of order.

### Intelligence channel-specific fixes (#8118)

- **WhatsApp:** deduplicated command and button deliveries, and ephemeral success is now reported only after a message is actually posted.
- **Teams:** personal refusal replies are now allowed when a reference omits the participant ID, while still rejecting known mismatches.
- **Slack:** download credentials are now scoped to file hosts, and email was removed from `lookup_slack_user`.

## Other Changes

- Long Intelligence threads now load in a single burst (#8247). Replayed history is held until `replay_complete` and handed to AG-UI in one coalesced update, with the reconnect cursor following the events handed on and held events dropped on detach or teardown. On `replay_failed`, held events and the rest of that replay are dropped and requested again from the join's cursor. This works on current AG-UI releases, applying as separate updates where the `coalesce` option is unavailable.

## 0.12.0 - 2026-10-28

### Security

- Includes security fixes for Teams and other Channels integrations.

We recommend upgrading the supported `@copilotkit/channels*` packages used by
your application to `0.12.0`, including `@copilotkit/channels` and
`@copilotkit/channels-teams` where installed. If you use Telegram, review the
migration guidance below before upgrading.

### Features

- Render static JSX as images in managed Slack and Teams messages. (#6146)
- Combine rendered cards with native buttons and carousel layouts. (#6146)

### Fixes

- Keep Takumi out of native-only app bundles to avoid Next.js build failures. (#7874)

Image rendering is opt-in: import `takumiRenderer` from
`@copilotkit/channels/takumi` and configure
`render: { renderer: takumiRenderer }` when creating your channel.

### Breaking Changes

- Remove the built-in Telegram adapter and umbrella export. (#7928)

`@copilotkit/channels-telegram` and `@copilotkit/channels/telegram` are no longer
included. Applications using either must migrate to a custom adapter or another
supported channel before upgrading.

## 0.11.1 - 2026-10-16

### Features

- feat: AG-UI 1.0 for CopilotKit (#7270) (7693a04)

### Fixes

- fix(runtime): ping Intelligence sockets every 15s so 30s proxy idle timeouts don't drop runs (#7568) (75f5721)
- fix(channels-slack): deliver a message click's state.values to the handler (#6523) (269fe33)
- fix(channels): explain missing Channel agent configuration (#7411) (33db9a8)

### Other Changes

- chore(deps): bump @ag-ui/\* to 1.0.2 (PNI-551) (#7648) (d4afb51)

## 0.11.0 - 2026-09-22

### Fixes

- fix(channels): widen the express floor so an older express stops failing installs (#7331) (1504af8)
- fix(channels)!: stop shipping a zod range from channels-discord and channels-telegram (PE-30) (#7325) (e2199aa)

### Breaking Changes

- fix(channels)!: stop shipping a zod range from channels-discord and channels-telegram (PE-30) (#7325) (e2199aa)
  `@copilotkit/channels-discord` and
  `@copilotkit/channels-telegram` no longer declare `zod`. An application that
  relied on them to install it must declare zod itself.

## 0.10.0 - 2026-09-15

This release trims the dependency footprint of the Teams and Slack channel packages and fixes Telegram code-block formatting. The headline change is a breaking one for self-hosted Teams users: the Microsoft Agents SDK and Express are now optional peer dependencies.

## Breaking Changes

### Self-hosted Teams now requires installing the Microsoft Agents SDK (#7084)

`@microsoft/agents-hosting`, `@microsoft/agents-activity`, and `express` are now **optional peer dependencies** of `@copilotkit/channels-teams` (and of `@copilotkit/channels`, whose `./teams` subpath re-exports the adapter). Previously these were bundled as hard dependencies, which pulled the entire Microsoft Agents stack — and its pinned `zod` version — into every install that transitively depended on the Teams package, including plain runtime installs that never used Teams.

These SDKs are only reached from the self-hosted surface (the Teams adapter and listener). Managed Channels reach the package solely through `@copilotkit/channels-teams/render`, whose module graph touches none of them, so **managed users are unaffected**.

Because optional peers are not auto-installed, this is silent at install time and surfaces at import:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@microsoft/agents-hosting'
```

**Migration** — if you self-host Teams, add the Microsoft packages:

```sh
npm install @microsoft/agents-hosting @microsoft/agents-activity
```

`express` is also an optional peer, but it is now loaded lazily inside `createTeamsServer().start()`, so you only need it if you use the built-in listener. Bots that serve `POST /api/messages` from their own HTTP server never need to install it. Both package READMEs carry the install line and the reasoning.

## Fixes

- **Teams:** `express` is now imported lazily inside `createTeamsServer().start()` instead of at module scope. Importing `@copilotkit/channels-teams` no longer requires `express`, and calling `start()` without it produces a clear, actionable error naming the missing package rather than a raw module-not-found. Verified serving on both Express 4 and 5. (#7084)

- **Slack & Teams:** Removed unused `zod` and `zod-to-json-schema` runtime dependencies from `@copilotkit/channels-slack` and `@copilotkit/channels-teams`. Neither Teams file imported them, and Slack used `zod` for a single tool schema, now written directly against the [Standard Schema](https://standardschema.dev) protocol. The JSON Schema shown to the model is unchanged. (#7081)

- **Slack:** The `lookup_slack_user` tool now reports the actual received type for invalid arguments. Previously `null` and arrays both reported `received object` because `typeof` reports `"object"` for both; validation now matches Zod's naming (`null`, `array`, `string`, `number`). Validation behavior is unchanged — only the message the agent reads back is corrected. (#7081)

- **Telegram:** Tagged fenced code blocks (e.g. ` ```js `) now emit Telegram's `<pre><code class="language-js">` form instead of leaking the language token into the code body. Untagged fences stay plain `<pre>`, and single-line fences become inline `<code>`. Only valid language tokens become class names; anything else falls back to plain `<pre>`. (#6622)

## Other

- **Release tooling:** Fixed GitHub Release notes so the generated changelog section actually ships as the release body, instead of falling back to a bare `Release <tag>`. Release notes are now kept in a source-controlled, per-lane changelog. (#6830)

## 0.9.3 - 2026-09-14

This release trims unused dependencies from the channels packages and fixes Telegram code-fence formatting, alongside internal release-tooling improvements. All channels packages are published at version 0.9.3.

## Fixes

- **Removed the `zod` runtime dependency from `@copilotkit/channels-slack` and `@copilotkit/channels-teams`** (#7081). `channels-teams` declared `zod` (and `zod-to-json-schema`) without importing either, and `channels-slack` used `zod` for a single tool parameter schema. The `lookup_slack_user` schema is now written directly against the [Standard Schema](https://standardschema.dev) protocol — which is all `defineChannelTool` ever required — and emits a byte-for-byte identical JSON Schema, so the tool descriptor the model sees is unchanged, including its strip-unknown-keys behavior. Because `channels-intelligence` is an unconditional dependency of the runtime, these unused declarations previously pulled a `zod` range into every runtime install; removing them eliminates the nested duplicate copies those packages caused.

- **Fixed Telegram code-fence rendering for tagged code blocks** (#6622). Fenced blocks with a language tag (e.g. ` ```js `) now emit Telegram's `<pre><code class="language-js">` form instead of leaking the language token into the code body. Untagged fences remain plain `<pre>`, and single-line ` ```code``` ` fences become inline `<code>`. The language token is validated against a strict pattern (keeping `c++`, `objective-c`, and `asp.net` working) and falls back to a plain `<pre>` when it doesn't match.

## Internal

- **Release notes now ship correctly with GitHub Releases** (#6830). GitHub Release bodies are now generated from a source-controlled, per-lane changelog rather than a scratch file that never reached the release branch, so channels releases carry real notes instead of a bare `Release <tag>` fallback.
