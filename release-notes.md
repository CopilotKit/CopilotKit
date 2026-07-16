# CopilotKit v1.63.0

CopilotKit v1.63.0 is a minor release focused on the new Channels package architecture, managed channel runtime reliability, package type resolution, and docs/showcase hardening.

## Install

```bash
npm install @copilotkit/react-core@1.63.0 @copilotkit/react-ui@1.63.0 @copilotkit/runtime@1.63.0
```

## Highlights

- **Batteries-included Channels architecture** — the Channels family now has a platform-neutral core plus the `@copilotkit/channels` umbrella package with adapter subpaths, UI/testing helpers, and a synchronized release scope. ([#5948](https://github.com/CopilotKit/CopilotKit/pull/5948), [#5989](https://github.com/CopilotKit/CopilotKit/pull/5989))
- **Runtime-owned managed channel lifecycle** — the runtime handler now owns managed channel activation and teardown, including optional `channels-intelligence` integration and exported channel control types. ([#5963](https://github.com/CopilotKit/CopilotKit/pull/5963))
- **Realtime transport parity for managed channels** — realtime delivery now preserves message kinds, actor identity, history/files, and delete renders so managed transports behave consistently with direct transports. ([#5983](https://github.com/CopilotKit/CopilotKit/pull/5983))
- **Package type resolution fixes** — React package declarations now resolve under `bundler`, `node16`, and `nodenext`, and the type validation gate no longer masks internal resolution errors. ([#5264](https://github.com/CopilotKit/CopilotKit/pull/5264))
- **Terminal runtime event safety** — `finalizeRunEvents` no longer emits additional events after a terminal event has been reached. ([#5885](https://github.com/CopilotKit/CopilotKit/pull/5885))

## Docs and showcase

- Added thread import guides for shell-docs. ([#5915](https://github.com/CopilotKit/CopilotKit/pull/5915))
- Documented the CLI import command and refreshed integration CLI pages. ([#5824](https://github.com/CopilotKit/CopilotKit/pull/5824))
- Refreshed stale contributing commands, LangGraph `RunnableConfig` imports, and Anthropic model IDs. ([#5982](https://github.com/CopilotKit/CopilotKit/pull/5982))
- Restored showcase single-source Python tool symlinks and added the iron-rule guard. ([#5975](https://github.com/CopilotKit/CopilotKit/pull/5975))
- Emitted A2UI v0.9 nested operations from TypeScript builders for Python/TypeScript parity. ([#5971](https://github.com/CopilotKit/CopilotKit/pull/5971))

## Migration notes

- The Channels SDK has completed the public naming move from `Bot` terminology to `Channel` terminology. Update imports and helper names to the `channels` package and `createChannel`/`Channel*` APIs. ([#5849](https://github.com/CopilotKit/CopilotKit/pull/5849), [#5939](https://github.com/CopilotKit/CopilotKit/pull/5939))
- Existing direct channel adapter packages remain available. New applications can use `@copilotkit/channels` for the full umbrella or `@copilotkit/channels-core` plus the adapter package they need for selective installs. ([#5948](https://github.com/CopilotKit/CopilotKit/pull/5948))

## Packages republished at `1.63.0`

`@copilotkit/runtime`, `@copilotkit/react-core`, `@copilotkit/react-ui`, `@copilotkit/react-native`, `@copilotkit/core`, `@copilotkit/shared`, `@copilotkit/runtime-client-gql`, `@copilotkit/sdk-js`, `@copilotkit/vue`, `@copilotkit/voice`, `@copilotkit/web-inspector`, `@copilotkit/web-components`, `@copilotkit/a2ui-renderer`, `@copilotkit/react-textarea`, `@copilotkit/sqlite-runner`, and `@copilotkit/agentcore-runner`.

**Full changelog:** [`v1.62.3...v1.63.0`](https://github.com/CopilotKit/CopilotKit/compare/v1.62.3...v1.63.0)
