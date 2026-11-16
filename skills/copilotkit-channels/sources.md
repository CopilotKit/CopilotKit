# Sources

Files read from CopilotKit/CopilotKit to write this skill.
Generated: 2026-08-01

## SKILL.md

- `examples/templates/slack/app/managed.ts`: the canonical managed-Channel wiring: `createChannel`,
  `new CopilotKitRuntime({ intelligence, identifyUser, channels })`, `createCopilotKitNodeListener`,
  `await listener.channels.ready()`, and `listener.channels.stop()` on shutdown. Also the
  source of the "Channel history does not include the in-flight turn" note.
- `examples/templates/slack/app/index.ts` and `examples/templates/teams/app/index.tsx`: the self-hosted adapter
  variants, read to state the managed-versus-OSS boundary accurately.
- `packages/runtime/src/runtime/core/runtime.ts`: `CopilotIntelligenceRuntimeOptions`
  (`intelligence`, `identifyUser`, `channels?: Channel[]`) and `CopilotSseRuntimeOptions`
  (`channels?: undefined`), which is what makes "Channels require the Intelligence runtime"
  a type-level fact rather than a convention.
- `packages/runtime/src/runtime/intelligence-platform/client.ts`:
  `CopilotKitIntelligenceConfig`: `apiKey` required, `apiUrl`/`wsUrl` optional and defaulting
  to the managed platform, and the warning that the two planes are separate hosts.
- `packages/runtime/src/runtime/core/channel-manager.ts`: `ready()` is one-shot and
  settles on the initial activation outcome.
- `packages/runtime/src/runtime/endpoints/node.ts`: this
  lifecycle-owning wrapper STARTS activation at creation; `ready()` there is optional and
  purely await-and-observe.
- `packages/runtime/src/runtime/core/fetch-handler.ts`: this
  stays LAZY: activation is triggered by the first `ready()` and never before.
- `packages/runtime/src/runtime/endpoints/auto-start-channels.ts`: why the split exists
  (an isolate recycles per request, so separate cold starts would mint competing listeners
  for one Channel) and that `activateChannels: false` is the clean opt-out.
- `packages/channels-*/README.md`: the self-hosted adapter family, for the scope boundary.
- `showcase/shell-docs/src/content/docs/channels/intelligence.mdx`: the managed browser
  contract: durable draft, Fast CLI and Guided manual peer paths, provider completion, and
  the separate runtime handoff.
- `CopilotKit/Intelligence/docs/superpowers/specs/2026-08-01-teams-one-command-setup-prd.md`:
  the accepted Teams setup contract, including local-only branding artifacts, resumable
  blocked outcomes, and the Created-and-installed boundary.
