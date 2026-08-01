# Sources

Files read from CopilotKit/CopilotKit to write this skill.
Generated: 2026-08-01

## SKILL.md

- `examples/slack/app/managed.ts` — the canonical managed-Channel wiring: `createChannel`,
  `new CopilotRuntime({ intelligence, identifyUser, channels })`, `createCopilotNodeListener`,
  `await listener.channels.ready()`, and `listener.channels.stop()` on shutdown. Also the
  source of the "Channel history does not include the in-flight turn" note.
- `examples/slack/app/index.ts` and `examples/teams/app/index.tsx` — the self-hosted adapter
  variants, read to state the managed-versus-OSS boundary accurately.
- `packages/runtime/dist/v2/runtime/core/runtime.d.mts` — `CopilotIntelligenceRuntimeOptions`
  (`intelligence`, `identifyUser`, `channels?: Channel[]`) and `CopilotSseRuntimeOptions`
  (`channels?: undefined`), which is what makes "Channels require the Intelligence runtime"
  a type-level fact rather than a convention.
- `packages/runtime/dist/v2/runtime/intelligence-platform/client.d.mts` —
  `CopilotKitIntelligenceConfig`: `apiKey` required, `apiUrl`/`wsUrl` optional and defaulting
  to the managed platform, and the warning that the two planes are separate hosts.
- `packages/runtime/src/v2/runtime/core/channel-manager.ts` — `ready()` is one-shot and
  settles on the initial activation outcome.
- `packages/runtime/src/v2/runtime/endpoints/node.ts` — the lazy-activation contract: the
  connection opens on `await listener.channels.ready()` and never before, neither at
  creation nor on mount.
- `packages/channels-*/README.md` — the self-hosted adapter family, for the scope boundary.
