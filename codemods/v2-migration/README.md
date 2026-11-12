# @copilotkit/v2-migration

Codemod that moves a CopilotKit app from v1 to 2.0. Published to the [Codemod registry](https://app.codemod.com/registry), not npm.

## Usage

Run it in the root of your app, on a clean git tree:

```bash
npx codemod @copilotkit/v2-migration
```

On a tree with uncommitted changes the CLI asks before it runs. In CI or any other non-interactive shell it waits for that answer forever, so pass `--allow-dirty` there.

Then finish with the skill it installs, or by hand: search for `TODO(copilotkit-2.0)`.

## What it does

- **Import paths.** `@copilotkit/react-core/v2` and `@copilotkit/runtime/v2` (and their subpaths) become the package roots. `@copilotkit/shared/event-transforms` becomes `@copilotkit/runtime`. Paths in `import()`, `require()`, and `vi.mock()` move too.
- **Stylesheets.** The 2.0 components add their own styles, so imports of `@copilotkit/react-ui/styles.css`, `@copilotkit/react-core/v2/styles.css`, and `@copilotkit/react-core/styles.css` are deleted. This codemod reads JavaScript and TypeScript only. For `@import` in CSS files, run [`remove-stylesheet-import`](../remove-stylesheet-import.ts).
- **The provider.** The v1 `<CopilotKit>` (also re-exported from `/v2`) becomes `<CopilotKitProvider>`, and `CopilotKitProps` becomes `CopilotKitProviderProps`. 2.0 keeps `CopilotKit` and `CopilotKitProps` as aliases, but `CopilotKitProvider` is the preferred name. On the provider, `agent` becomes `agentId`: the alias takes the 2.0 props, so this rename is still needed. An `onError` on the v1 provider gets a TODO: 2.0 calls it with `{ error, code, context }`, and the v1 `type` is now `code`. When the file already imports `CopilotKitProvider`, the `CopilotKit` import is removed, so the name is not imported twice.
- **`useCopilotAction`.** A call becomes the 2.0 hook that does the same job, as v1 dispatched it: `useHumanInTheLoop` for `renderAndWaitForResponse` (and `renderAndWait`, renamed to `render`), `useFrontendTool` for a `handler`, and `useRenderTool` for a call that only renders. A literal `Parameter[]` becomes the same Zod schema (`z.object({...})`, with `.describe()`, `.optional()` and `z.enum()`), and `import { z } from "zod"` is added when the file has none. `disabled` becomes `available`, and the v1 render props `handler` (in HITL) and `args` (in a render-only call) get their 2.0 names. A render that reads `result` gets a TODO: 2.0 passes the result as a string. A catch-all (`"*"`), a spread, or `parameters` that are not a literal array keeps the TODO.
- **`useCopilotReadable`.** A call becomes `useAgentContext({ description, value })`, as v1 last behaved: `parentId` and `categories` (which v1 already ignored) and `available: "enabled"` are dropped, `convert` is applied to the value, and the dependency list is dropped because the context updates whenever the value changes. A call whose returned id is used, or `available: "disabled"`, keeps the TODO.
- **`useCoAgent`.** `const { state, setState, ... } = useCoAgent<T>({ name, initialState })` becomes `useAgent({ agentId: name })`, and each destructured value keeps v1's behavior: `state` is the agent's state (or `initialState` while it has none, and `initialState` is set on the agent before it runs), `setState` merges an object or applies an updater, `running`, `threadId` and `name` read the agent, and `run`, `start` and `stop` go through `useCopilotKit()`. A result that is not destructured, state managed outside (`state` / `setState` options), `config`, `configurable` or `nodeName` keeps the TODO.
- **`useCopilotChat`.** `const { visibleMessages, isLoading, appendMessage, setMessages, stopGeneration, runChatCompletion } = useCopilotChat()` becomes `useAgent()` (the default agent, as in v1) and `useCopilotKit()`: `visibleMessages` is `agent.messages`, `isLoading` is `agent.isRunning`, `appendMessage` adds the message and runs the agent unless `followUp` is false, and `stopGeneration` and `runChatCompletion` stop and run it. A call with options, a result that is not destructured, or `reloadMessages`, `reset`, `isAvailable` or the MCP server members keep the TODO.
- **v1 GraphQL messages.** `new TextMessage({ role: Role.User, content })` from `@copilotkit/runtime-client-gql` becomes the AG-UI message `{ id: crypto.randomUUID(), role: "user" as const, content }`, and the import goes once nothing uses it.
- **v1 Next.js App Router endpoint.** `copilotRuntimeNextJSAppRouterEndpoint({ runtime, serviceAdapter, endpoint })` becomes `createCopilotRuntimeHandler({ runtime, basePath: endpoint, mode: "single-route" })` on the same route, so the route file does not move and `handleRequest(req)` keeps working (the 2.0 client finds a single-route runtime on its own). The service adapter becomes the runtime's `default` agent, the one v1 ran the chat on: `new OpenAIAdapter({ model })` is `new BuiltInAgent({ model: openaiText(model) })`, and the same for `AnthropicAdapter` and `GoogleGenerativeAIAdapter`, with v1's default model when none was given. `ExperimentalEmptyAdapter` adds no agent. Another adapter, adapter options other than `model`, or a runtime with an option 2.0 does not take (`remoteEndpoints`, `actions`, ...) keeps the TODO. The 2.0 runtime options (`generativeUI`, `mcpApps`, `openGenerativeUI`, `a2ui`, ...) do not block the conversion.
- **Stale TODOs.** When no call of a rewritten v1 hook is left in a file, the TODO lines an earlier run wrote about it are deleted.
- **v1 chat components.** On `CopilotChat`, `CopilotPopup` and `CopilotSidebar` from `@copilotkit/react-ui`, the `labels` keys get their 2.0 names (`title` → `modalHeaderTitle`, `placeholder` → `chatInputPlaceholder`, `initial` → `welcomeMessageText`, ...), `onSetOpen` becomes `onOpenChange`, and each prop 2.0 removed (`instructions`, `makeSystemMessage`, `Input`, `Messages`, `icons`, ...) gets a TODO that names the 2.0 way.
- **Same name, different API.** `useFrontendTool`, `useHumanInTheLoop`, `useRenderToolCall` and `CopilotRuntime` exist in v1 and 2.0 with different arguments. They get a TODO only where the file uses the v1 shape (a `parameters` array, a `useRenderToolCall` config, a runtime without `agents`), so a second run changes nothing.
- **v1 APIs with the same 2.0 API.** The import moves to the 2.0 package, for example `CopilotChat` from `@copilotkit/react-ui` to `@copilotkit/react-core`.
- **LangGraph.** `LangGraphAgent` and `LangGraphHttpAgent` import from `@ag-ui/langgraph`.
- **Built-in Agent.** `BuiltInAgent`, `defineTool`, and the other agent exports import from `@copilotkit/runtime/agent`. The AI SDK helpers (`convertMessagesToVercelAISDKMessages`, `createSafeUrlDownload`, ...) import from `@copilotkit/runtime/agent/ai-sdk`. This also applies to imports from `@copilotkit/runtime/v2`. In a `new BuiltInAgent({ ... })` config, a model string becomes its TanStack AI adapter, and the adapter is imported: `"openai/gpt-5"` becomes `openaiText("gpt-5")` from `@tanstack/ai-openai`. The same goes for `anthropic`, `google` (or `gemini`) and `vertex`, with `/` or `:`. `maxRetries: 3` becomes `retry: { maxRetries: 3 }`. Any other `model` that is not an adapter gets a TODO, and so does each removed key (`temperature`, `providerOptions`, `apiKey`, `urlDownload`, `mcpServers`, ...). The `mcpServers` TODO tells you to create clients with `createMCPClient` from `@tanstack/ai-mcp` and pass them as `mcp: { clients: [client] }`. Imports of the removed `resolveModel`, `classifyModelSpec`, `BuiltInAgentModel`, `ModelSpecifier`, and `MCPClientConfig` get a TODO, and so do imports of `MCPClient` and `MCPTransport`.
- **Markdown rendering.** 2.0 renders markdown with CopilotKit's own renderer, not Streamdown. The Streamdown props on the `markdownRenderer` slot (`components`, `shikiTheme`, `remarkPlugins`, ...) get a TODO that names the 2.0 way. Calls of the removed Vue `useKatexStyles` are deleted. Imports of the `@copilotkit/markdown` AST types (`StreamingMarkdownAstNode`, `StreamingMarkdownNodeType`, `StreamingMarkdownNodeRendererKey`, `VueStreamingMarkdownNodeRendererKey`) get a TODO: the node types include `math`, and task-list items carry `checked`.
- **Chat labels and renderer lists.** A complete `CopilotChatLabels` object (one that does not spread another object) gets a TODO, because 2.0 adds label keys. A call that changes `renderToolCalls` or `renderActivityMessages` in place (`push`, `splice`, `sort`, and the other array methods that change the array) gets a TODO, because both are read-only arrays in 2.0.
- **Angular copy buttons.** `copied` on `CopilotChatUserMessageCopyButton` and `CopilotChatAssistantMessageCopyButton` is a read-only signal. Each `.copied.set(...)` and `.copied.update(...)` in a file that imports one of these buttons gets a TODO that names `handleCopy()` and the `copyButton` slot.
- **License checker.** Each read of the removed `runtime.licenseChecker` gets a TODO. The 2.0 call, `await runtime.getLicenseChecker()`, is async, so the codemod does not rewrite it.
- **Angular runtime config.** 2.0 throws in production when `provideCopilotKit` gets no `runtimeUrl`, `licenseKey`, `agents`, or `selfManagedAgents`. A call with no argument, or with an object literal that has none of these keys, gets a TODO. A config with a spread, a computed key, or a variable is not changed, because the codemod cannot see all of its keys.
- **1.x deprecations that 2.0 removed.** `BasicAgent` becomes `BuiltInAgent`, `BasicAgentConfiguration` becomes `BuiltInAgentClassicConfig`, and `createNodeFetchHandler` becomes `createCopilotNodeHandler`. The no-op prop `showDevConsole` on `<CopilotKitProvider>` is deleted. The other removed deprecations get a TODO that names the 2.0 way.
- **Angular chat configuration.** In a subclass of `CopilotChatConfiguration`, `this._setOverride(threadId, explicit)` becomes `this.setActiveThreadId(threadId, { explicit })`. A subclass that defines its own `_setOverride` gets a TODO, because 2.0 does not call that method.
- **Generative UI.** Each `filterCatalog(…)` call from `@copilotkit/a2ui-renderer` gets a TODO: 2.0 removed the package, and drops standard components with `standardUI.omit([...])` in `createGenerativeUI`. Zod uses of the Vue and Angular `OpenGenerativeUIContentSchema` and `GenerateSandboxedUiArgsSchema` (`.parse`, `.safeParse`, other zod members, use inside a zod schema) get a TODO that names the Standard Schema call, `["~standard"].validate(value)`. Reads of the removed Angular `CopilotA2UIRecovery` members and the removed `open-generative-ui-placeholder` test id get a TODO.
- **A2UI v0.9 to generative UI.** `createCatalog(definitions, renderers, options)` from `@copilotkit/a2ui-renderer`, and `createAngularCatalog` from `@copilotkit/angular/a2ui`, become `createGenerativeUI({ id, extends, components })` from the framework's `/generative-ui` entry: definitions and renderers merge by name into one `{ component, description, props }` entry, `catalogId` becomes `id` (the v0.9 default id when there was none), and `includeBasicCatalog: true` becomes `extends: [standardUI]`. A component with the name of a standard component replaced the basic one in v0.9; the catalog then extends `standardUI.omit([...])` without those names, because `createGenerativeUI` throws when a name comes from two places. A definitions or renderers object in the same file that nothing else uses is inlined; one used elsewhere, or imported, is read by name (`...definitions.Card`, `renderers.Card`). When both are imported from modules of the app (`./definitions`, `./renderers`), the codemod reads those modules for the component names. In a definitions object (typed `CatalogDefinitions`, or passed to `createCatalog`), `satisfies CatalogDefinitions` is deleted, and the v0.9 conventions get their 2.0 form: `children: z.array(z.string())` becomes `childList()`, `child: z.string()` becomes `child()` (a `.describe()` text becomes its description), and an `action` prop whose schema is not a plain value moves to `events: { action: { parameters: z.object({}) } }`, which the component calls as a function. On a `Button` the event is `onClick`, because the runtime turns `Button.action` from a v0.9 agent into `onClick`. In a renderers module, the `CatalogRenderers` type is deleted and each renderer gets the TODO. A definitions module that does not import the v0.9 client is found by its v0.9 shapes (a union with a `{ path }` binding, or a `{ componentId, path }` child-list template), and gets the same conversion. In these files, a one-argument `z.record(value)` (Zod 3) becomes `z.record(z.string(), value)`, because 2.0 reads the schemas with Zod 4. The v0.9 `.describe("REF:<ref>|<text>")` markers are deleted, and the text after `|` stays as the description. Each component gets a TODO, because its body must change: it gets plain resolved props, slots for children, and events or functions instead of `dispatch`. A component without a `description` gets a second TODO. In files that import the v0.9 client, `DynamicStringSchema`, `DynamicNumberSchema`, `DynamicBooleanSchema` and `DynamicStringListSchema` become `z.string()`, `z.number()`, `z.boolean()` and `z.array(z.string())` (and the `Dynamic*` types become plain types), `ChildListSchema` becomes `childList()`, a union with a `{ path }` binding object becomes its plain type, and `zod-v3` imports become `zod`. On the provider, `a2ui={{ catalog }}` becomes `generativeUI={{ ui: catalog }}`, and an `a2ui` with no catalog or the basic catalog is deleted (2.0 uses the standard catalog). In Angular, `a2ui: { catalog }` leaves `provideCopilotKit` and `provideGenerativeUI({ ui: catalog })` is added next to it. On `new CopilotRuntime(...)`, `a2ui: { ... }` becomes `generativeUI: { a2uiVersion: "0.9", ... }` (merged into an existing `generativeUI`), and `a2ui: { enabled: false }` is deleted. The other provider options (`theme`, `onAction`, ...), a catalog with a spread or unknown options, `ActionSchema`, `DataBindingSchema`, and an `a2ui` value the codemod cannot read get a TODO. Imports of the v0.9 client that nothing uses any more are deleted, and each one that is left (`A2UIRenderer`, `useA2UIContext`, the removed deprecations `createA2UICatalog`, `useA2UIStore`, ...) gets a TODO that names the generative UI replacement.
- **Angular text box.** In a class that extends `CopilotChatTextarea` from `@copilotkit/angular`, calls of `super.ngAfterViewInit()` are deleted and `override` is removed from `ngAfterViewInit`. The 2.0 text box measures its height after each render, so it has no `ngAfterViewInit()`. See [Chat UI in 2.0](https://docs.copilotkit.ai/migrate/chat-2.0#angular-text-box).
- **Everything else** gets a `// TODO(copilotkit-2.0):` comment that names the 2.0 replacement and links its docs. The codemod does not rewrite a call whose arguments changed: `useCopilotAction` to `useFrontendTool` needs a Zod schema, and only you or an agent can write it.
- **A skill.** The last step installs an agent skill that resolves the TODOs, updates `package.json`, and runs your build.

## Runtime adapters in 2.0

The codemod automatically migrates named imports from the runtime root and the
`/express`, `/hono`, `/v2/express`, and `/v2/hono` entry points when all uses can
be resolved in the current file:

- Express factories become `createCopilotNodeListener`. The generated app-owned
  router preserves mount prefixes, request URLs seen by hooks, and `next()`
  fallthrough. Single endpoints register POST and OPTIONS on the exact path.
- Hono factories become `createCopilotRuntimeHandler`. Calls to `.fetch(request)`
  become direct calls, and root Hono `.route("/", endpoint)` mounts become Fetch
  callbacks. Inline factories are evaluated once at setup time.
- Next.js `handle(endpoint)` wrappers from `hono/vercel` are removed. The import
  stays if another Hono app in the file still uses it.
- Single-route factories receive `mode: "single-route"`. Omitted CORS becomes
  `cors: true`, preserving the old default. Supported literal Express CORS options
  are translated to the Fetch configuration's names.
- Aliases and existing bindings are preserved without introducing name collisions.
  Running the codemod again leaves the migrated handlers unchanged.

For example:

```ts
// Before
import { createCopilotEndpoint } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
const endpoint = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});
export const POST = handle(endpoint);

// After
import { createCopilotRuntimeHandler } from "@copilotkit/runtime";
const endpoint = createCopilotRuntimeHandler({
  cors: true,
  runtime,
  basePath: "/api/copilotkit",
});
export const POST = endpoint;
```

Router customization, exported/escaped app objects, shadowed bindings, dynamic
options, namespace/dynamic imports, and custom CORS callbacks receive a TODO.
Express CORS objects that implicitly reflect request headers also need manual
migration: the Fetch handler cannot reproduce that behavior with a static
wildcard. Framework dependencies are not removed from the app's package manifest;
they may still serve other routes.

See the [runtime migration guide](https://docs.copilotkit.ai/migrate/runtime-2.0)
for the remaining manual cases.

## Limits

- Run it **before** you upgrade the packages. In v1, `@copilotkit/react-core` and `@copilotkit/runtime` mean the v1 API, so the codemod reads them that way. Running it again on its own output changes nothing.
- Namespace imports (`import * as CK from "@copilotkit/react-core"`) only get a TODO.
- CSS `@import` lines are not changed.
- Vue single-file components (`.vue`) are not changed. Delete `useKatexStyles` from them by hand.
- Vue single-file components (`.vue`) keep `:a2ui`. Replace it with `:generativeUI="{ ui }"` by hand.
- A v0.9 catalog definitions file that does not import `@copilotkit/a2ui-renderer` or `@copilotkit/angular/a2ui` (plain zod with its own `{ path }` unions) is not changed. Make its prop types plain by hand.
- CSS that targets Streamdown's `[data-streamdown]` attributes stops matching. The codemod does not read CSS.
- Import paths inside template literals (for example a script generated as a string) are not changed. Only plain string literals are.

## Check it on real apps

`e2e/run-examples.mjs` runs the codemod on every example of a git ref (by default `origin/main`, the v1 line) and type-checks each app against the 2.0 packages. Pack the public packages first, then run it:

```bash
mkdir -p /tmp/ck-tarballs
for d in packages/*/; do (cd "$d" && node -e "process.exit(require('./package.json').private ? 1 : 0)" && pnpm pack --pack-destination /tmp/ck-tarballs); done
node codemods/v2-migration/e2e/run-examples.mjs --tarballs /tmp/ck-tarballs --out /tmp/ck-e2e
```

Each app is type-checked on its own 1.x packages, on 2.0 before the codemod, on 2.0 after it, and after the dependency step of the skill. `summary.md` sorts each remaining error by kind: `app` (the app had it on 1.x), `todo` (next to a TODO), `missing-dep`, `copilotkit-import`, `unchanged` (a v1 use the codemod left), and `unexplained` (most likely a codemod gap). It also reports whether a second run changes anything, and the v1 imports left without a TODO. `--only <text>` limits the run to the matching examples.

## Develop

```bash
pnpm nx run @copilotkit/v2-migration:test         # fixtures in tests/ts and tests/tsx
pnpm nx run @copilotkit/v2-migration:test:runtime # compile and run the migrated Express/Hono fixture
pnpm nx run @copilotkit/v2-migration:check-types
pnpm nx run @copilotkit/v2-migration:validate     # the codemod package shape
```

Each fixture is a folder with `input` and `expected`. To refresh `expected` after a change, run `codemod jssg test` with `-u`, then read every diff before you commit it.

`scripts/v1-api.ts` is a snapshot of every v1 export and its 2.0 replacement, taken before v1 was deleted. Do not edit it by hand. Corrections that came after the snapshot go in `OVERRIDES` in `scripts/codemod.ts`.
