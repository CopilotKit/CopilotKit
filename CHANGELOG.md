# Changelog — monorepo lane

Every `@copilotkit/*` package listed under `scopes.monorepo` in
`release.config.json`. They share one version.

`release / create-pr` prepends a section here for each release, and
`release / publish` reads the newest section back as the GitHub Release body.
To change what ships, edit the section on the release PR branch before merging.

The other release lanes keep their own file:
[`packages/angular/CHANGELOG.md`](packages/angular/CHANGELOG.md) and
[`packages/channels/CHANGELOG.md`](packages/channels/CHANGELOG.md).

Entries begin with the first release cut after this file was added. Earlier
releases have no changelog: the per-package files from the changesets era stopped
at `1.55.2` while the lane shipped `1.69.3`, and they are recoverable from git
history (for example `git show v1.69.3:packages/core/CHANGELOG.md`).

## 1.73.1 - 2026-09-21

This release makes Express an optional peer dependency so Express 5 apps can compile against the runtime, adds a `messageFilter` for trimming conversation history, and fixes several human-in-the-loop, MCP, and Intelligence transport issues across the client and runtime.

## Breaking Changes

### `@copilotkit/runtime`: Express is now an optional peer dependency (#7278)

`express` is no longer a hard dependency of `@copilotkit/runtime`. It moves to an optional peer dependency with a widened range of `^4.18.0 || ^5.0.0`. This fixes compilation failures for Express 5 apps, where the runtime previously shipped Express 4 types and `app.use(copilotRouter)` failed with a missing `.param()` type error.

**What you need to do:**

- **If you mount the Express adapter,** install Express yourself: `npm install express` (`^4.18.0 || ^5.0.0`). Hono, Next.js, and Node consumers no longer install Express transitively (a saving of ~68 packages / 3.9 MB).
- **If you're on npm/yarn and previously relied on hoisted Express**, you must now declare it directly.
- **If you're pinned to Express `< 4.18`**, npm installs will fail with `ERESOLVE` until you upgrade. (The floor moved from `^4.21.2` to `^4.18.0`; the security-floor choice is now yours to make.)

**Type changes:**

- `CopilotExpressRouter` is now declared structurally rather than as Express's own `Router`. The methods consumers use (`use`, `get`, `post`, `put`, `patch`, `delete`, `options`, `all`, `route`, `param`) are all preserved, so mounting and configuring the returned router keeps compiling. The internal `stack` member is no longer typed.
- `createCopilotEndpointSingleRouteExpress` now returns `CopilotExpressRouter` rather than Express's `Router`. If you annotated its result as `: Router`, widen the annotation.
- Handler parameters on the structural methods are typed as `any`, so handlers are no longer type-checked against Express's `Request`/`Response`.

If you mount the Express adapter without Express installed, you'll now get a clear error at call time telling you to install it or use the Hono adapter instead.

v1 users are unaffected — `copilotRuntimeNodeExpressEndpoint` delegates to the Hono node-http endpoint and never imported Express.

## Features

- **`@copilotkit/core`, `@copilotkit/react-core`: trim the history sent to a runtime agent (#6926).** A new `messageFilter` lets you rewrite the conversation history CopilotKit sends on each run — useful when your backend already stores the thread (LangGraph, Mastra, Strands, etc.) and re-sending it inflates request bodies or duplicates context. Set it via the `messageFilter` prop on `<CopilotKit>` (also available on Vue, Angular, and React Native providers) or `CopilotKitCore`:

  ```tsx
  <CopilotKit
    runtimeUrl="/api/copilotkit"
    messageFilter={(messages) => messages.slice(-1)}
  >
    {children}
  </CopilotKit>
  ```

  The filter rewrites only the request body — the rendered transcript is untouched. Tool-call/result pairs are automatically repaired so a trimmed pair can't produce a protocol error, and a filter that throws or returns invalid data falls back to the full thread with a warning. Intelligence and suggestion runs are exempt. It applies to runtime-discovered agents too.

- **`@copilotkit/react-core`: `useFrontendTools` for variable-length tool lists (#6994).** Register a set of frontend tools built from state, props, or a backend response — something `useFrontendTool` (singular) couldn't do since it registers exactly one tool per call.

  ```tsx
  useFrontendTools(
    reports.map((report) => ({
      name: `open_${report.id}`,
      description: `Open the ${report.title} report`,
      handler: async () => navigate(`/reports/${report.id}`),
    })),
    [navigate],
  );
  ```

  The hook keys on a value signature (including `description`), removes exactly the tools a render registered when they drop out of the array, and compares `deps` by identity so a changed callback re-registers correctly. Exported from `@copilotkit/react-core/v2` and `/v2/headless`.

## Fixes

- **`@copilotkit/react-core`: v2 entry can now be imported from a server component (#7328).** The v2 entry previously carried star re-exports of external packages, breaking builds on Next.js App Router (Next 15 with webpack by default, and Next 16 with webpack) when `CopilotKitProvider` was placed in `app/layout.tsx`. Exports are now listed explicitly; the public surface is unchanged.

- **`@copilotkit/react-core`, `@copilotkit/vue`: stable chat row keys prevent HITL remount flash (#6152).** Chat rows were keyed by `message.id`, but a message's id can change mid-turn (e.g. LangChain swapping a placeholder id for the provider's final id). This caused rows to remount — visibly flashing a rendered HITL approval card during a tool's `executing → complete` transition. Rows are now keyed stably using tool-call ids as anchors, with zero behavioral change for conversations without tool calls.

- **`@copilotkit/core`, `@copilotkit/vue`: wait for the user on provider HITL tools, and abort wildcard handlers (#7315).** Vue's `humanInTheLoop` provider prop resolved immediately instead of waiting for user input, so the HITL UI flashed and disappeared; it now stays pending until `respond` is called and brings the prop path to parity with React and the `useHumanInTheLoop` composable. Separately, wildcard (`name: "*"`) tool handlers in core never received the abort signal, so a wildcard HITL tool stayed pending forever when the run was stopped — they now receive it.

- **`@copilotkit/runtime`: resolve v1 agents per request so actions and MCP see the caller (#7157).** The v1 `CopilotRuntime` shim resolved agents once at startup. Now:
  - A dynamic `actions` function runs per request with that request's `forwardedProps` and URL.
  - Request-supplied `mcpServers` / `mcpEndpoints` are honored.
  - MCP clients are keyed by credential (plus the client factory and endpoint config) rather than by URL alone, fixing cross-tenant client sharing (#2407). The cache is process-wide, LRU-capped at 100, closes evicted clients, and keeps clients alive while a run is calling their tools. MCP endpoint details are redacted in logs and tool descriptions.
  - A caller-supplied `agents` factory is now actually invoked per request instead of being discarded.
  - Tools attach to a per-request clone, so concurrent requests can't see each other's tools.

  **Note:** because MCP destinations are now caller-controlled, deployments that don't intend browser-chosen servers must reject them in their own `createMCPClient`. `runtime.instance.agents` is now a per-request factory function at runtime — resolve it with `resolveAgents(runtime.instance.agents, request)`.

- **`@copilotkit/core`, `@copilotkit/runtime`: Stop cancels only the run the client aborted (#6982).** Pressing Stop could cancel a newer run started on the same thread. The client now sends the specific `runId` it started (only while it can prove that run is still its own open run on that thread), and the runtime parses an optional `{ runId }` body for every runtime kind. Bodies carrying any other key, or non-JSON, are rejected with `400`. Old and new clients/runtimes remain compatible in every combination. (`@copilotkit/sqlite-runner` still ignores `runId`, so run-scoped stops behave thread-wide there.)

- **`@copilotkit/core`: honor single-route transport for Intelligence chat (#7069).** Intelligence chat and reconnect now use the configured single-route mount instead of posting to unsupported `/agent/{run,connect}` paths. Trailing slashes on the runtime URL are preserved, and Intelligence join requests no longer follow redirects (preventing chat bodies from being forwarded elsewhere).

- **`@copilotkit/core`: carry a changed runtime mode onto a preserved proxy agent (#7178).** If a runtime changed mode under an open page (e.g. a redeploy dropping `intelligence` to `sse`), every later run kept taking the Intelligence delegate path and threw. The new mode is now pushed onto the preserved agent, with any stale delegate torn down safely — no full reload needed.

- **`@copilotkit/web-inspector`: let embedding pages own the thread title (#7336).** Added a `showThreadTitle` property (defaulting to `true`) so hosts that render their own thread heading can hide the Inspector's duplicate while keeping the conversation toolbar, tabs, messages, and metadata drawer.

- **`@copilotkit/web-inspector`: add Intelligence access and preserve Learning shortcuts (#7194).** The Learning results view header now has an **Open Intelligence** button that opens the runtime-provided app origin (including custom deployments). Existing scoped Learning shortcuts retain their destinations, new-tab behavior, and telemetry.

## Other Changes

- **`@copilotkit/web-inspector`: aligned Inspector navigation and thread conversation layout (#7334).** Saved threads now open in a conversational view using the existing message renderer, with terminology updated to **Rich Threads**, **Automatic Learning**, and **Conversation**. The thread title and conversation actions stay visible while scrolling, the thread list can be hidden, and Expand/Collapse controls are unified into a single toggle. The event timeline, raw AG-UI events, state, and metadata remain accessible.

- **`@copilotkit/shared`: reuse attachment and rich UI event transforms (#7272).** Attachment content construction now lives in `@copilotkit/shared` and is reused across frameworks. A new `@copilotkit/shared/event-transforms` server-only entry adds `transformRecordedEvents`, letting importers pass recorded AG-UI events through the Open GenUI and A2UI converters without executing agents or tools.

## 1.73.0 - 2026-09-19

This release brings automatic Learning skill delivery to BuiltInAgent, more resilient SSE streaming, and richer runtime telemetry, alongside a set of targeted fixes across core, react-core, and Vue.

## Features

- **BuiltInAgent can now consume published Learning skills** through an optional `learnedSkills` configuration — no wrapper or separate adapter package required (#7254). Classic mode automatically adds the catalog and executable skill tools, and factory callbacks receive `{ catalog, tools }`. When skills are available, classic mode now defaults to 10 steps so the model can act on loaded guidance; an explicit `maxSteps` still takes precedence.
- **Runtime telemetry now reports which vendor a run actually reached** (#7183). Because the AI SDK reports the same provider label (e.g. `openai.responses`) whether a model points at OpenAI, Azure, OpenRouter, or a local endpoint, runs now emit a classified `llmHostClass` derived from the resolved endpoint. Only the closed classification is emitted — never the raw host — so customer-identifying details such as Azure resource names stay out of telemetry.

## Fixes

- **Keep quiet SSE streams alive** (#6984). Long-running reasoning or slow tools could leave a stream silent long enough for proxies, load balancers, or browsers to drop the connection. The runtime now writes a `: keep-alive` SSE comment after a configurable idle period. A new `sseKeepAliveIntervalSeconds` option controls this (default 15, `0` disables); the interval is idle-based, so active streams add nothing.
- **Finalize suggestion streams without buffering events** (#6983). The suggestion path no longer retains every provider event in memory just to close unfinished messages and tool calls at the end. A new incremental finalizer in `@copilotkit/shared` observes events as they stream and keeps only the ids of open lifecycles.
- **Serve the debug event feed only where it was asked for** (#7210). The `GET /cpk-debug-events` feed was previously served whenever `NODE_ENV` was unset, meaning a plain `node server.js` could expose full conversation content. The feed is now gated on a single predicate: either `debug` is explicitly enabled on the runtime, or `NODE_ENV` is exactly `"development"`. See the migration note below.
- **Unsample anonymous runtime telemetry and emit each event once** (#7177). Anonymous events are no longer locally sampled by default, and v1 root-runtime requests no longer emit duplicate rows for each per-request event. Every event now carries a `telemetry_surface` field (`"v1"` or `"v2"`), and the surviving events carry better attribution, including accurate `requestType` values. `COPILOTKIT_TELEMETRY_SAMPLE_RATE` remains available as an opt-down, and `COPILOTKIT_TELEMETRY_DISABLED` remains the opt-out.
- **Name the real replacement in v1 deprecation notices** (#7212). Several v1 exports claimed no v2 replacement existed when one did. Deprecation tooltips now point `LangGraphHttpAgent` to `HttpAgent` from `@ag-ui/client`, and the endpoint factories (`copilotRuntimeNextJSAppRouterEndpoint`, `copilotRuntimeNodeHttpEndpoint`, `copilotRuntimeNodeExpressEndpoint`) to their renamed v2 handlers.
- **Warn in development when a tool is registered with no parameters schema** (#7206). A tool registered without a `parameters` schema is advertised to the model as taking no arguments, with no prior signal to the developer. Core now emits a development-only warning (once per tool) that names the tool and explains how to fix it — including writing `parameters: z.object({})` to declare a zero-argument tool on purpose. Production builds are unaffected.
- **Keep the `runtimeUrl` trailing slash for single-route requests** (#7033). A `runtimeUrl` such as `https://host/service/copilotkit/` was slash-stripped before use, so single-route requests hit the slash-free URL. Because a trailing slash can select a different proxy or gateway location, the endpoint is now used verbatim for single-route targets, while path-joined REST routes still avoid double slashes. There is no behavior change for URLs without a trailing slash.
- **Include readable context in `CopilotTask`** (#6474). `CopilotTask` can once again include entries registered through `useCopilotReadable`. Readable context is bridged from `getContextForAgent()` and appended without replacing existing document/tree output, and agent-scoped contexts remain filtered.
- **Vue: replace listener introspection with reactive callbacks** (#7188). Vue scoped slots could lose a statically declared `@stop` listener after transitioning from idle to running, because capability gating relied on non-reactive vnode props. Scoped-slot command handlers are now always callable, with capability gated by explicit `canStop`, `canAddFile`, and `canTranscribe` flags on `#input` and `#welcome-screen`. See the migration note below.
- **Allow a plain `FC` for the `chatView` slot** (#7126, #7156). `chatView` no longer requires namespace static members; a normal `FC<CopilotChatViewProps>` now assigns without `Object.assign` or a cast. This is a type-only change.
- **Ship missing license notices** (#7125). The `@copilotkit/shared` and `@copilotkit/vue` packages declared MIT but omitted their license files; these now include explicit MIT `LICENSE` files.

## Documentation

- Stopped promising tool-argument validation across the `useFrontendTool` reference pages for react-core, Vue, and react-native (#7215). These schemas drive the advertised tool schema and TypeScript inference; runtime arguments are JSON-parsed but not validated against the schema.

## Breaking Changes

### Debug event feed gating (#7210)

If your self-hosted runtime relied on the debug event feed being served with an unset or non-`development` `NODE_ENV`, it will now return `404`. To restore access:

- Set `NODE_ENV=development`, **or**
- Explicitly enable `debug` on the runtime, which works in any environment.

Production (`NODE_ENV=production`) behavior is unchanged.

### Vue chat slot capability gating (#7188)

Custom `#input` and `#welcome-screen` slots now always receive command handlers, so `v-if="onStop"` is no longer a reliable capability signal. If you gated custom controls on the presence of `onStop`, switch to the new `canStop` (and sibling `canAddFile` / `canTranscribe`) flags. Default controls are unchanged.

### Telemetry emitter renames (#7177)

The `telemetry_emitter` values for the Python and .NET runtimes were normalized to `runtime-python` and `runtime-dotnet` (from `native-python` and `native`). If you filter telemetry on these emitter values, update your queries accordingly.

## 1.72.0 - 2026-09-15

This release repairs several v1 runtime surfaces that were silently broken since v1.50.0 and removes the deprecated `useRenderTool` shim from React Native.

## Breaking Changes

### React Native: `useRenderTool` no longer accepts `description` or `handler` (#7118)

`@copilotkit/react-native` now re-exports react-core's `useRenderTool` directly and no longer ships its own render-tool implementation. The routing shim introduced in 1.68 — which forwarded calls carrying `description` or `handler` to `useFrontendTool` — has been removed.

**Migration:**

- A `useRenderTool` call that passes `description` or `handler` no longer type-checks and no longer registers a tool. Rename it to `useFrontendTool` with the same config object. The compiler error is `TS2769: No overload matches this call` (the offending property is named in the nested per-overload detail).
- A render body reading `args` still needs to be renamed to `parameters`; the shim never covered this.
- The wildcard `name: "*"` continues to paint unmatched tool calls without registering a tool named `*`.

## Fixes

### Runtime: v1 `actions` and `mcpServers` execute again (#6931)

In-process `action.handler` and MCP `tool.execute` were advertised to the model but never invoked — every call returned `undefined`, producing a malformed `TOOL_CALL_RESULT` with no `content` that reached the browser as a Zod error. Both are now restored, and actions that genuinely cannot run return a readable string instead of `undefined`. Additional fixes:

- `mcpServers` is now attached independently of `actions`, so MCP-only runtimes receive their tools.
- Tool attachment is now idempotent — repeated endpoint construction no longer advertises duplicate copies of every action to the model.
- MCP endpoints that were unreachable at first resolution now retry and recover instead of staying toolless for the runtime's lifetime.

### Runtime: adapter configuration is honored (#6931)

- `ExperimentalOllamaAdapter` now builds a real model from Ollama's OpenAI-compatible endpoint (fixing `Unknown provider "ollama"`) and accepts a new `baseUrl` option to name a host.
- `UnifyAdapter` now falls back to `process.env.UNIFY_API_KEY` instead of authenticating with the literal placeholder string, which caused 401s on the default path.
- `GoogleGenerativeAIAdapter` now uses the configured `apiKey` and honors the `apiVersion` option when the caller sets it (carried on the base URL). The provider default of `v1beta` is left untouched.

### Runtime & React Textarea: MCP auth and CopilotTextarea crash (#6931)

- The MCP `sse` transport now sends auth headers correctly (wrapped in `requestInit`), so servers requiring authentication no longer answer 401 and silently fail to connect.
- `CopilotTextarea` insertion/editing no longer throws `TypeError: runtimeClient.asStream is not a function`. It now returns an empty stream (matching the autosuggestions hook) with a one-time warning that the v1 backend it relied on was removed in v1.50.0.

**Note:** `LangChainAdapter` still throws, and `BedrockAdapter` was intentionally left unchanged — both require separate design decisions.

## 1.71.2 - 2026-09-12

This release adds native Intelligence runtime support to `@copilotkit/runtime` and improves how the Inspector handles ephemeral threads.

## Features

- **Native Intelligence runtimes and shared conformance** (#6967): The TypeScript runtime now consumes the released `@ag-ui/mcp-apps-middleware@^0.1.0` and runs against the same cross-language conformance suite as CopilotKit's native runtimes. This release also includes several runtime hardening fixes:
  - Enforces MCP tool visibility filtering and unambiguous account/proxy selection, rejecting proxy requests outside the selected agent scope.
  - Preserves identity and request-boundary contracts — SDK update precedence and mounted routing are retained, browser identity aliases can no longer override the authenticated user, and stop requests are cloned before application authentication consumes the body.
  - Validates AG-UI tool arguments against their JSON schemas, keeping relaxed structured output limited to the A2UI tool.
  - Preserves safe failure reporting and completion analytics — failures are reported without private diagnostic payloads, and completion counts are retained for streams containing `RUN_ERROR`.
  - Advertises and consumes the January MCP Apps MIME type correction (`text/html;profile=mcp-app`).

## Fixes

- **Preserve the ephemeral Threads upgrade path in the Inspector** (#7098): The Inspector no longer treats any Threads list endpoint as durable Threads support. OSS apps using an in-memory agent runner can now inspect ephemeral conversations while still seeing a clear path to durable Threads:
  - The full Rich Threads setup CTA is shown when Threads are unavailable, or when Intelligence is off and no local threads exist.
  - When the first ephemeral thread appears, the Inspector switches to the thread list with a "Keep your threads" banner explaining that history can disappear on restart.
  - "Make them permanent" opens the full setup view inline, with a sticky "Back to your threads" link to return to local history.
  - The banner and setup override are removed once Intelligence becomes available.
- **Remove optional feedback prompt copy from Inspector onboarding** (#7099): Dropped an unnecessary optional diagnostic-feedback instruction from the shared feature setup prompt used by Threads and Learning, while retaining the instruction not to reveal credentials.

## 1.71.1 - 2026-09-11

This release focuses on runtime MCP fixes, React hook performance, and improvements to the Inspector's onboarding experience.

## Fixes

### Runtime

- **MCP SSE headers now reach the wire** (#6930): v2 MCP `sse` servers accepted a `headers` auth map (for example, `Authorization: Bearer …`), but those headers were never sent, causing auth-required servers to 401 and drop their tools from the run. Headers are now passed via `requestInit`. No public type change.
- **Removed a duplicate `@ag-ui/client` install** (#7095): `@copilotkit/runtime` bundled `@ag-ui/mcp-middleware@0.0.1`, which pinned `@ag-ui/client` as an exact dependency and nested a second copy alongside the one consumers already had. Because `@ag-ui/client` carries types, the duplicate produced confusing type errors (for example, a mismatch naming a private `_debug` property) for anyone also depending on `@ag-ui/client`. Bumping to `0.0.2` moves the client to a peer dependency, so it resolves to the host's copy.

### React Core

- **Stopped unnecessary `useInterrupt` re-renders** (#6969): `useInterrupt` receives interrupt events through its own agent subscription, but was still re-rendering on every message, state, and run-status update. It now skips that update subscription entirely.

### Web Inspector

- **Unified locked Threads onboarding** (#7094): Threads availability is now gated on the Runtime Threads capability rather than license metadata, so every locked state shows the same Rich Threads setup guidance (product header, Copy setup prompt, Talk to an Engineer CTA, and video). Empty Threads views no longer display local example threads.
- **Learning setup prompt now targets Learning** (#7037): The Learning pane's "Copy setup prompt" button previously copied a Threads prompt (`--intent add-rich-threads`) and announced "Threads setup prompt copied." It now correctly targets Learning (`--intent add-learning`), including the accessible label. Learning does not require the Threads feature.
- **Hide enabled features from the launcher HUD** (#7075): The launcher heads-up display no longer shows Rich Threads or Automatic Learning once they're enabled. When only the dismiss action remains, the HUD collapses to a compact, centered state with no pointer.

## Improvements

### Web Inspector

- **Shorter copied onboarding prompt** (#7030): The prompt copied from the Inspector and feature cards now opens with a single command — `npx --yes copilotkit@latest onboard start --run <run-id>` — instead of two sentences of coding-agent identification. Identification moves into the prompt graph. The old wording still works against the published CLI.
- **Feature buttons point at CLI intent routes** (#7004): The Inspector's seven per-feature "Copy setup prompt" buttons now emit `onboard start … --intent <slug>`, targeting the CLI's feature routes instead of duplicating setup prose in the Inspector. Each tile maps to exactly one intent, enforced by the type system and a test.

### Skills

- **Consolidated packaged skills** (#7029): The nine packaged knowledge skills have been replaced with two entry points (`copilotkit` and `copilotkit-cli`) that look answers up rather than restating a stale copy of the documentation. As part of this, the `skills` directory is no longer included in the published tarballs for `@copilotkit/react-core`, `@copilotkit/runtime`, and `@copilotkit/a2ui-renderer`.
- **Audited react-core skill claims** (#6997): Corrected several stale or incorrect citations and stopped documenting Cloud keys (`publicApiKey` / `publicLicenseKey`) as the path to CopilotKit Intelligence, which is configured server-side on the runtime.

## 1.71.0 - 2026-09-09

This release converges React Native's render-tool hooks onto react-core, improves Copilot context timing during page navigation, and adds provider-level agent configuration. It also includes fixes for nullable tool schemas, the Vue human-in-the-loop lifecycle, and the Inspector experience.

## Breaking Changes

### `@copilotkit/react-native`: render-tool hooks converged onto react-core (#6533)

React Native's `useRenderTool` was previously an alias that forwarded to `useFrontendTool`, which caused a range of subtle bugs — most notably, a wildcard renderer (`name: "*"`) registered a frontend tool literally named `*` rather than a display-only fallback. This release removes React Native's own implementation and re-exports core's two distinct hooks, so each capability has exactly one implementation — and `"*"` works as a real wildcard on React Native for the first time.

**What's removed:** `RenderToolProps`, `RenderToolFunction`, and `UseRenderToolOptions` are gone from `@copilotkit/react-native`. `useRenderTool` still exists this release as a **deprecated shim** that routes by call shape and warns in development (once per tool name); it is scheduled for removal in the next minor.

**Migration:**

| Before                                                                    | After                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `useRenderTool({ name, description, parameters, handler, render }, deps)` | `useFrontendTool({ …identical object }, deps)` — the shim keeps this working with a warning this release |
| renderer-only registration (previously impossible)                        | `useRenderTool({ name, parameters, render, agentId? }, deps)`                                            |
| wildcard registered a tool named `*`                                      | `useRenderTool({ name: "*", render })` — now works like the web                                          |
| render props `{ args, status, … }`                                        | `{ parameters, status, … }` — **not** covered by the shim; the render body still needs the rename        |
| `RenderToolProps<T>` (args-shaped)                                        | `RenderToolProps<S>` (parameters-shaped, generic over schema)                                            |
| bare `RenderToolProps`                                                    | now requires the schema type argument (`TS2314`)                                                         |
| `UseRenderToolOptions<T>`                                                 | gone — write the config inline                                                                           |
| `RenderToolFunction<T>`                                                   | gone — use the opt-in `FrontendToolRenderFunction<T>` from `/headless` to narrow renderer return types   |

Note that some call shapes (hoisted configs, spread props, and untyped/`@ts-nocheck` call sites) will not be caught by the compiler — the shim's development warning is the only signal for those, so audit them by hand. `status` also moves from the `ToolCallStatus` enum to core's string-literal union; this is not a break, as enum members remain assignable to their own literal types.

## Features

- **`@copilotkit/react-core`: provider-level agent selection** (#6892). You can now set a default agent directly on `CopilotKitProvider` via the `agentId` prop, rather than only on `<CopilotChat>` or the v1 compatibility component. It acts as the last fallback before the default agent and is consulted by `CopilotChat`, `CopilotThreadsDrawer`, `useAgent`, `useSuggestions`, and nested chat configuration — an explicit `agentId` still wins everywhere. Sibling chats keep their own thread identities.
- **`@copilotkit/react-core`: renderers can return `null`** (#6533). Tool-call renderers may now return `null` to intentionally suppress UI, via widened return types on `useRenderTool` and `defineToolCallRenderer`. This reaches React Native consumers as well.
- **`@copilotkit/web-inspector`: escape actions for Learning setup** (#6995). The Learning onboarding flow is now reversible: a "Go back" action returns to the overview, and you can re-copy the setup prompt without leaving the flow, with copy confirmation, automatic reset, and failure feedback.

## Fixes

- **`@copilotkit/react-core`: v1 readables register before sibling effects run** (#6968). `useCopilotReadable` now registers in a layout effect instead of a passive effect, so an earlier-mounted consumer (such as a chat's connect request) no longer runs against an empty context store during page transitions.
- **`@copilotkit/runtime`: accept nullable frontend tool schemas** (#6958). Nullable tool fields that reach the built-in agent as `anyOf: [{type: "string"}, {type: "null"}]` no longer throw `Invalid JSON schema`. Required nullable fields still require a value; optional fields can be omitted; invalid non-null values still fail validation. Covers nullable unions, arrays, and Zod-generated fields.
- **`@copilotkit/vue`: human-in-the-loop lifecycle aligned with React** (#5965). `useHumanInTheLoop` now honors its `AbortSignal` (rejecting aborted or in-flight interactions with an explicit abort error instead of hanging), exposes the full render contract including `toolCallId` and static `agentId`, routes statuses through an exhaustive check, and preserves exact scoped-renderer cleanup on scope disposal.
- **`@copilotkit/react-core`: improve Inspector message shortcuts** (#6974). Message shortcuts now stay in sync with Inspector visibility. Adds a wrench shortcut with a hover menu and a hide-until-reload action, adds `CopilotChat.inspectorTools` (with provider settings taking precedence), and restricts the Inspector to local development.
- **Release notes now actually ship** (#6830). GitHub Release bodies were falling back to a bare `Release <tag>` because the generated notes were gitignored and never reached the release branch. Release notes are now recorded in a source-controlled `CHANGELOG.md` per release lane, scoped to the packages in each lane, and read back as the release body. (This is the machinery producing these very notes.)
