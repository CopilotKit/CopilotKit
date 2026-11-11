# v1 to 2.0 mappings

Every example imports from the 2.0 package roots. There is no `/v2` subpath in 2.0.

## Provider

`<CopilotKitProvider>` is the 2.0 provider. The codemod already renamed `<CopilotKit>` to it and `agent` to `agentId`. For the other v1 props:

| v1 prop                                                | 2.0                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `threadId`                                             | `<CopilotChat threadId="...">`, or wrap the chat in `<CopilotChatConfigurationProvider threadId="...">` |
| `guardrails_c`, `cloudRestrictToTopic`, `authConfig_c` | Removed. Ask the user how they want to replace them.                                                    |
| `forwardedParameters`                                  | Removed. Set model parameters on the agent.                                                             |
| `transcribeAudioUrl`, `textToSpeechUrl`                | Removed. Voice input goes through the runtime's transcription service.                                  |

## Angular runtime config

2.0 throws in production when `provideCopilotKit` gets no `runtimeUrl`, `licenseKey`, `agents`, or `selfManagedAgents`. The codemod marks these calls with a TODO. Add the runtime URL that the app uses. If the app sets it later with `updateRuntime`, also give it at startup:

```ts
import { provideCopilotKit } from "@copilotkit/angular";

export const copilotKitProviders = provideCopilotKit({
  runtimeUrl: "/api/copilotkit",
});
```

If the app has no runtime, ask the user which runtime URL to use. See [Angular: a missing runtime throws in production](https://docs.copilotkit.ai/migrate/providers-2.0#angular-a-missing-runtime-throws-in-production).

## Hooks

### `useCopilotReadable` → `useAgentContext`

```tsx
import { useAgentContext } from "@copilotkit/react-core";

function UserContext() {
  useAgentContext({
    description: "The current user",
    value: { name: "Ada" },
  });
  return null;
}
```

### `useCopilotAction` → `useFrontendTool`

`parameters` is a Zod schema in 2.0, not a `Parameter[]` list.

```tsx
import { useFrontendTool } from "@copilotkit/react-core";
import { z } from "zod";

function MyComponent() {
  useFrontendTool({
    name: "myTool",
    description: "Run my tool",
    parameters: z.object({}),
    handler: async () => "done",
  });
  return null;
}
```

A v1 action that only had a `render` and needed the user to answer becomes `useHumanInTheLoop`:

```tsx
import { useHumanInTheLoop } from "@copilotkit/react-core";
import { z } from "zod";

function Confirmation() {
  useHumanInTheLoop({
    name: "confirmAction",
    description: "Ask the user to confirm",
    parameters: z.object({}),
    render: ({ respond }) => (
      <button onClick={() => respond?.(true)}>Confirm</button>
    ),
  });
  return null;
}
```

### `useRenderToolCall` → `useRenderTool`

Registers a renderer for a tool that runs on the backend. The 2.0 hook named `useRenderToolCall` is a different, low-level API.

```tsx
import { useRenderTool } from "@copilotkit/react-core";
import { z } from "zod";

function StatusTool() {
  useRenderTool({
    name: "showStatus",
    parameters: z.object({}),
    render: ({ status, result }) => (
      <div>{status === "complete" ? result : "Running..."}</div>
    ),
  });
  return null;
}
```

### `useLangGraphInterrupt` → `useInterrupt`

```tsx
import { useInterrupt } from "@copilotkit/react-core";

function ApprovalInterrupt() {
  useInterrupt({
    render: ({ resolve }) => (
      <button onClick={() => resolve({ approved: true })}>Approve</button>
    ),
  });
  return null;
}
```

### `useCopilotChatSuggestions` → `useConfigureSuggestions`

```tsx
import { useConfigureSuggestions } from "@copilotkit/react-core";

function Suggestions() {
  useConfigureSuggestions({
    suggestions: [{ title: "Help", message: "Help me get started" }],
  });
  return null;
}
```

### `useCoAgent`, `useCoAgentStateRender`, `useCopilotChat` → `useAgent`

`useAgent` returns the agent: its messages, its state, and the methods that run it. Read https://docs.copilotkit.ai/reference/v2/hooks/useAgent and rewrite each use against it.

## Components

`CopilotChat`, `CopilotPopup`, and `CopilotSidebar` moved from `@copilotkit/react-ui` to `@copilotkit/react-core`, and their props changed. Check each prop against the component's docs page. The components add their own styles. Delete every CopilotKit stylesheet import, in JavaScript and in CSS.

```tsx
import { CopilotChat } from "@copilotkit/react-core";

function App() {
  return <CopilotChat agentId="my-agent" />;
}
```

### Angular `CopilotChatTextarea`

`CopilotChatTextarea` from `@copilotkit/angular` has no `ngAfterViewInit()` in 2.0. It measures its height after each render. The codemod deletes `super.ngAfterViewInit()` in subclasses and removes `override` from their `ngAfterViewInit`. If a subclass still calls `ngAfterViewInit()` on another instance of the text box, delete that call. See [Chat UI in 2.0](https://docs.copilotkit.ai/migrate/chat-2.0#angular-text-box) for the behavior changes in the chat input, recorder, sidebar, and previews.

## Chat labels and renderer lists

### Complete `CopilotChatLabels` objects

2.0 adds label keys, so a complete labels object fails to type-check. Spread the defaults and keep only the keys the app changes:

```ts
import { CopilotChatDefaultLabels } from "@copilotkit/core";
import type { CopilotChatLabels } from "@copilotkit/core";

export const labels: CopilotChatLabels = {
  ...CopilotChatDefaultLabels,
  chatInputPlaceholder: "Ask me anything...",
};
```

If the object is only an override, type it as `Partial<CopilotChatLabels>` instead.

### `renderToolCalls` and `renderActivityMessages` changed in place

Both are read-only arrays in 2.0. Give the setter a new list:

```tsx
import { useCopilotKit } from "@copilotkit/react-core";
import type { ReactToolCallRenderer } from "@copilotkit/react-core";

function useExtraRenderer(renderer: ReactToolCallRenderer<unknown>) {
  const { copilotkit } = useCopilotKit();
  copilotkit.setRenderToolCalls([...copilotkit.renderToolCalls, renderer]);
}
```

To add one renderer from a component, prefer `useRenderTool`.

### Angular copy buttons

`copied` on `CopilotChatUserMessageCopyButton` and `CopilotChatAssistantMessageCopyButton` is a read-only signal. The codemod marks each `.copied.set(...)` and `.copied.update(...)` with a TODO. To copy the text and show the check mark, call `handleCopy()` on the button. It copies the `content` input and shows the check mark for 2 seconds. If the app copies by its own logic, render its own button in the `copyButton` slot and keep the state in that button.

```ts
this.copyButton().handleCopy();
```

## Markdown rendering

2.0 renders assistant messages with `@copilotkit/markdown`, not Streamdown. It does streaming-safe GFM, tables, autolinks, and citations. It does not do syntax highlighting, KaTeX math, or mermaid diagrams. Docs: https://docs.copilotkit.ai/migrate/markdown-renderer

The `markdownRenderer` slot and the provider's `markdownRenderer` prop take one of these:

- a class string, which still works;
- a config object for the built-in renderer: `className`, `nodeRenderers`, `caret`, `options`, `onLinkClick`, `onCitationClick`;
- a component that takes `MarkdownRendererProps` (`{ content, isStreaming?, className? }`).

Fix each Streamdown prop that the codemod marked:

| Streamdown prop                                                                                                                                                         | 2.0                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components` (keyed by HTML tag)                                                                                                                                        | `nodeRenderers`, keyed by node type: `a` → `link`, `h1`-`h6` → `heading` (`node.level`), `pre`/`code` → `codeBlock`/`inlineCode`, `img` → `image`, `table` → `table`, `li` → `listItem` |
| `shikiTheme`                                                                                                                                                            | `nodeRenderers.codeBlock` with your highlighter, or a renderer component                                                                                                                |
| `remarkPlugins`, `rehypePlugins`, `remarkRehypeOptions`                                                                                                                 | A `react-markdown` renderer component (example below)                                                                                                                                   |
| `mermaid`, `controls`                                                                                                                                                   | A renderer component (Streamdown in the app), or delete the prop                                                                                                                        |
| `isAnimating`, `parseIncompleteMarkdown`, `mode`, `BlockComponent`, `parseMarkdownIntoBlocksFn`                                                                         | Delete the prop                                                                                                                                                                         |
| `allowedElements`, `disallowedElements`, `allowElement`, `skipHtml`, `unwrapDisallowed`, `urlTransform`, `allowedLinkPrefixes`, `allowedImagePrefixes`, `defaultOrigin` | Delete the prop. The built-in renderer escapes raw HTML and allows only safe URLs                                                                                                       |

A node renderer gets `node`, `children`, and `defaultNode`. Wrap `defaultNode` to restyle a node and keep the built-in output. If you render `node.url` yourself, it is the raw model output, and the built-in URL check does not run on it.

```tsx
import type { DefaultMarkdownRendererProps } from "@copilotkit/react-core";

// Module scope, so the value keeps its identity between renders.
const markdownRenderer: DefaultMarkdownRendererProps = {
  className: "prose",
  nodeRenderers: {
    link: ({ defaultNode }) => <span className="my-link">{defaultNode}</span>,
    codeBlock: ({ node }) => (
      <pre className="my-code">
        <code data-lang={node.info}>{node.text}</code>
      </pre>
    ),
  },
};
```

If the app needs highlighting, math, diagrams, or remark/rehype plugins, ask the user first. Then plug in a renderer component, defined at module scope:

```tsx
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MarkdownRendererProps } from "@copilotkit/react-core";

function ReactMarkdownRenderer({ content }: MarkdownRendererProps) {
  return <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>;
}

<CopilotKitProvider runtimeUrl="/api/copilotkit" markdownRenderer={ReactMarkdownRenderer}>
```

For Streamdown, install `streamdown` in the app and render `<Streamdown>{content}</Streamdown>` in the same way.

CSS that targets `[data-streamdown]` no longer matches. Search the stylesheets for `data-streamdown` and move those rules to the `nodeRenderers` output or to `className`.

Vue: delete every `useKatexStyles` import and call, including in `.vue` files. The export was removed.

Code that reads the `@copilotkit/markdown` AST (the codemod marks imports of `StreamingMarkdownAstNode`, `StreamingMarkdownNodeType`, `StreamingMarkdownNodeRendererKey`, and `VueStreamingMarkdownNodeRendererKey`):

- Add a `math` case to each exhaustive `switch (node.type)` and to each map keyed by every node type. The parser makes `math` nodes (`text`, `display`) only when the `enableMath` option is `true`.
- A task-list item (`- [x] done`) is a `list-item` node with `checked: true` or `checked: false`. Its text no longer starts with `[ ]` or `[x]`. Read `node.checked` instead of the text.

Behavior changes with no code to mark (tell the user, do not change code): Angular now uses the same renderer as React and Vue, so raw HTML in model output shows as text and a single newline is a soft break. Angular no longer installs `marked` or `dompurify`. React and Vue render task-list items as disabled checkboxes. Docs: https://docs.copilotkit.ai/migrate/markdown-renderer#rendering-changes-in-20

## Generative UI

Docs: https://docs.copilotkit.ai/migrate/generative-ui-2.0

`OpenGenerativeUIContentSchema` and `GenerateSandboxedUiArgsSchema` from `@copilotkit/vue` and `@copilotkit/angular` are Standard Schemas, not zod schemas. They have no `.parse`, `.safeParse`, `.shape`, or other zod members, and they cannot go into a zod schema. Validate with `["~standard"].validate(value)`. It returns `{ value }` or `{ issues }` and does not throw:

```ts
import { OpenGenerativeUIContentSchema } from "@copilotkit/vue";

const result = OpenGenerativeUIContentSchema["~standard"].validate(value);
if (result instanceof Promise) throw new Error("unexpected async schema");
if (result.issues) throw new Error(result.issues[0]?.message);
const content = result.value;
```

If the code composed the schema into a zod schema, write those fields in zod in the app.

A2UI catalogs stay on Zod 3. `createCatalog` from `@copilotkit/a2ui-renderer` and `createAngularCatalog` from `@copilotkit/angular/a2ui` take Zod 3 schemas, because `@a2ui/web_core` reads Zod 3 schema internals. A Zod 4 schema is a type error. After the app moves to Zod 4, install Zod 3 under an alias and import it only in the catalog definitions:

```bash
npm install zod-v3@npm:zod@^3.25.76
```

```ts
import { z } from "zod-v3";
```

Do not use `zod/v3` from Zod 4 for this. It is a separate copy of the Zod 3 types, and mixed with `DynamicStringSchema` and the other `@a2ui/web_core` schemas it can make the typecheck run out of memory. The type parameter of `CatalogComponentDefinition` is now the props schema, not its shape: `CatalogComponentDefinition<typeof props>`, not `CatalogComponentDefinition<{ title: ZodString }>`.

`filterCatalog` from `@copilotkit/a2ui-renderer` infers its type. The codemod deletes explicit type arguments. Its type parameter is now the catalog type, not the component type.

Angular `CopilotA2UIRecovery` no longer exposes `lifecycle`, `retryRevealed`, `debugExposure`, `label`, `phase`, `failureDiagnostics`, or `retryDiagnostics`. Read the lifecycle with `readA2UILifecycleContent(content)` from `@copilotkit/angular`.

The Open Generative UI placeholder element (test id `open-generative-ui-placeholder`) was removed. While the agent generates, tests can query `open-generative-ui-progress-overlay` and `open-generative-ui-spinner`. Once generation ends, neither shows.

## Runtime

2.0 has no service adapters (`OpenAIAdapter`, `AnthropicAdapter`, ...) and no GraphQL endpoint. A model runs in a `BuiltInAgent`, and `createCopilotRuntimeHandler` serves the runtime. A v1 Next.js route:

```ts
const runtime = new CopilotRuntime();
const serviceAdapter = new OpenAIAdapter();

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
```

becomes, in `app/api/copilotkit/[[...slug]]/route.ts`:

```ts
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { openaiText } from "@tanstack/ai-openai";

const runtime = new CopilotRuntime({
  agents: { default: new BuiltInAgent({ model: openaiText("gpt-5.5") }) },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
```

The codemod automatically migrates supported local Express/Hono factories, their mounts, and Next.js wrappers. Preserve the generated app-owned Express router: it keeps mount prefixes, hook request URLs, exact single-route matching, and fallthrough intact. Remaining adapter TODOs need manual handling, especially custom CORS callbacks or implicit header reflection.

For Express, mount `createCopilotNodeListener` from `@copilotkit/runtime/node` under the runtime prefix with `basePath: "/"`. For Hono, pass `c.req.raw` to `createCopilotRuntimeHandler` from `@copilotkit/runtime`. Neither factory returns a framework router. The `/express` and `/hono` subpaths and all `createCopilotEndpoint*` aliases were removed. Set `mode: "single-route"` for former single-route factories and `cors: true` to retain the old permissive default. Replace `handle(app)` and `app.fetch(request)` with direct handler calls. See [runtime HTTP handlers in 2.0](https://docs.copilotkit.ai/migrate/runtime-2.0) for CORS option changes and channel lifecycle.

`runtime.licenseChecker` is removed. Replace each read with `await runtime.getLicenseChecker()`. It returns `undefined` when the runtime does not use Intelligence. If the read is in a function that is not async, make the function async and update its callers.

```ts
const status = (await runtime.getLicenseChecker())?.getStatus();
```

`@copilotkit/runtime` requires Node.js `^20.19.3 || >=22.13.0`. If `engines.node`, `.nvmrc`, a Dockerfile, or CI pins an earlier Node.js version, tell the user. Do not change it without asking.

## Built-in Agent

`BuiltInAgent` imports from `@copilotkit/runtime/agent`, and it runs on TanStack AI. The codemod already moved the imports. The AI SDK helpers (`convertMessagesToVercelAISDKMessages`, `convertToolsToVercelAITools`, `createSafeUrlDownload`, ...) moved to `@copilotkit/runtime/agent/ai-sdk`.

`model` takes a TanStack AI text adapter, not a model string. The codemod rewrote each model string it could read:

| 1.x model string                                      | 2.0 `model`                          | Package                  | API key from                                                                                                    |
| ----------------------------------------------------- | ------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `"openai/gpt-5"`, `"openai:gpt-5"`                    | `openaiText("gpt-5")`                | `@tanstack/ai-openai`    | `OPENAI_API_KEY`                                                                                                |
| `"anthropic/claude-sonnet-4-6"`                       | `anthropicText("claude-sonnet-4-6")` | `@tanstack/ai-anthropic` | `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`)                                                                 |
| `"google/..."`, `"gemini/..."`, `"google-gemini/..."` | `geminiText("gemini-2.5-pro")`       | `@tanstack/ai-gemini`    | `GOOGLE_API_KEY`, then `GEMINI_API_KEY`                                                                         |
| `"vertex/gemini-2.5-pro"`                             | `vertexText("gemini-2.5-pro")`       | `@tanstack/ai-vertex`    | `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` (or the `GOOGLE_VERTEX_*` names), or `GOOGLE_VERTEX_API_KEY` |

Each adapter reads its key from the environment, so you do not pass it. If TypeScript rejects a model name, the adapter package does not list that model.

Install the packages the app needs. The runtime does not install them:

1. Add `@tanstack/ai` and the package from the table for each adapter the code imports.
2. If a `BuiltInAgent` used `mcpServers`, add `@tanstack/ai-mcp`.
3. If the code imports from `@copilotkit/runtime/agent/ai-sdk`, keep or add `ai`.
4. Remove `@ai-sdk/*` packages that the code no longer imports.

The codemod moved `maxRetries` into the `retry` option: `maxRetries: 3` became `retry: { maxRetries: 3 }`.

Fix the TODOs:

| TODO on                                                       | 2.0                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model` with a string or a variable                           | Pass an adapter from the table. For `minimax/...`, ask the user which OpenAI-compatible adapter to use.                                                                                                                |
| `model: openai("...")` (an AI SDK model)                      | Pass a TanStack adapter (`openaiText("gpt-5.5")` from `@tanstack/ai-openai`). To keep the AI SDK model, use a `type: "aisdk"` factory.                                                                                 |
| `temperature`, `maxOutputTokens`, `topP`, `topK`, `seed`, ... | Removed. Put the provider's own option names in `modelOptions`, for example `modelOptions: { temperature: 0.2 }`. Check the names in the provider docs.                                                                |
| `providerOptions`                                             | Removed. Move the options for this provider into `modelOptions`. For reasoning effort, use the `reasoning` option, for example `reasoning: { level: "high" }`.                                                         |
| `apiKey`                                                      | Removed. The adapter reads its key from the environment. To pass a key in code, use the `create*` adapter factory, such as `createOpenaiChat(model, apiKey)`.                                                          |
| `urlDownload`                                                 | Removed. The provider gets attachment URLs as they are. Delete the key, and tell the user.                                                                                                                             |
| `mcpServers`, `mcpClients`                                    | Removed. Create each client with `createMCPClient` from `@tanstack/ai-mcp` (example below). Pass the clients as `mcp: { clients: [client] }`. The agent keeps them open across runs. Close them when the server stops. |
| `resolveModel`, `classifyModelSpec`                           | Removed. Pass an adapter as `model`. To handle a model name that the client forwards, set the `resolveModel` option on the agent config (below).                                                                       |
| `BuiltInAgentModel`, `ModelSpecifier`                         | Removed. Use `AnyTextAdapter` from `@tanstack/ai`.                                                                                                                                                                     |
| `MCPClientConfig`, `MCPClientProvider`, `MCPClient`, ...      | Import the MCP client types from `@tanstack/ai-mcp`.                                                                                                                                                                   |

An agent with an adapter, a retry limit, an MCP client, and a resolver for forwarded model names:

```ts
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { anthropicText } from "@tanstack/ai-anthropic";
import { createMCPClient } from "@tanstack/ai-mcp";
import { openaiText } from "@tanstack/ai-openai";

const docs = await createMCPClient({
  transport: { type: "http", url: "https://mcp.example.com/mcp" },
});

const agent = new BuiltInAgent({
  model: anthropicText("claude-sonnet-4-6"),
  modelOptions: { temperature: 0.2 },
  retry: { maxRetries: 3 },
  mcp: { clients: [docs] },
  resolveModel: (name) =>
    name === "gpt-5.5" ? openaiText("gpt-5.5") : undefined,
});
```

If `resolveModel` returns `undefined`, the agent keeps its configured `model`.

See [Built-in Agent in 2.0](https://docs.copilotkit.ai/migrate/runtime-2.0#built-in-agent).

## LangGraph

`LangGraphAgent` and `LangGraphHttpAgent` now come from `@ag-ui/langgraph`. That package does not handle CopilotKit's own LangGraph events. If the Python agent calls `copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, or `copilotkit_exit`, tell the user: those calls stop reaching the UI.

## Angular

`CopilotChatConfiguration` has no `_setOverride` in 2.0. The codemod rewrites `this._setOverride(threadId, explicit)` in a subclass to `this.setActiveThreadId(threadId, { explicit })`. A subclass that defines its own `_setOverride` gets a TODO: 2.0 does not call that method. Move its code into overrides of `setActiveThreadId` and `startNewThread`:

```ts
@Injectable()
export class AuditedChatConfiguration extends CopilotChatConfiguration {
  override setActiveThreadId(
    threadId: string,
    options?: { explicit?: boolean },
  ): void {
    console.log("thread", threadId);
    super.setActiveThreadId(threadId, options);
  }
}
```

`setActiveThreadId` and `startNewThread` now log a warning when the `threadId` option controls the thread. The call is still ignored.
