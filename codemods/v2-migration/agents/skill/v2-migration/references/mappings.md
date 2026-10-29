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

The codemod automatically migrates supported local Express/Hono factories, their mounts, and Next.js wrappers. Preserve the generated app-owned Express router: it keeps mount prefixes, hook request URLs, exact single-route matching, and fallthrough intact. Remaining adapter TODOs need manual handling, especially custom CORS callbacks or implicit header reflection.

For Express, mount `createCopilotNodeListener` from `@copilotkit/runtime/node` under the runtime prefix with `basePath: "/"`. For Hono, pass `c.req.raw` to `createCopilotRuntimeHandler` from `@copilotkit/runtime`. Neither factory returns a framework router. The `/express` and `/hono` subpaths and all `createCopilotEndpoint*` aliases were removed. Set `mode: "single-route"` for former single-route factories and `cors: true` to retain the old permissive default. Replace `handle(app)` and `app.fetch(request)` with direct handler calls. See [runtime HTTP handlers in 2.0](https://docs.copilotkit.ai/migrate/runtime-2.0) for CORS option changes and channel lifecycle.

## LangGraph

`LangGraphAgent` and `LangGraphHttpAgent` now come from `@ag-ui/langgraph`. That package does not handle CopilotKit's own LangGraph events. If the Python agent calls `copilotkit_emit_message`, `copilotkit_emit_state`, `copilotkit_emit_tool_call`, or `copilotkit_exit`, tell the user: those calls stop reaching the UI.
