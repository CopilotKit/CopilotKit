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

`CopilotChat`, `CopilotPopup`, and `CopilotSidebar` moved from `@copilotkit/react-ui` to `@copilotkit/react-core`, and their props changed. Check each prop against the component's docs page. The stylesheet is `@copilotkit/react-core/styles.css`.

```tsx
import { CopilotChat } from "@copilotkit/react-core";
import "@copilotkit/react-core/styles.css";

function App() {
  return <CopilotChat agentId="my-agent" />;
}
```

## Markdown rendering

2.0 renders assistant messages with `@copilotkit/markdown-renderer`, not Streamdown. It does streaming-safe GFM, tables, autolinks, and citations. It does not do syntax highlighting, KaTeX math, or mermaid diagrams. Docs: https://docs.copilotkit.ai/migrate/markdown-renderer

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
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";

const runtime = new CopilotRuntime({
  agents: { default: new BuiltInAgent({ model: "openai/gpt-5.4" }) },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
```

For Express, use `createCopilotExpressHandler` from `@copilotkit/runtime/express`. For Hono, use `@copilotkit/runtime/hono`.

## LangGraph

`LangGraphAgent` and `LangGraphHttpAgent` now come from `@ag-ui/langgraph`. That package does not handle CopilotKit's own LangGraph events. If the Python agent calls `copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, or `copilotkit_exit`, tell the user: those calls stop reaching the UI.
