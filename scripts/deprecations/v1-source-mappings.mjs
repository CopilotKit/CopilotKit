export const pilotMappings = [
  {
    file: "packages/react-core/src/hooks/use-frontend-tool.ts",
    v1: 'import { useFrontendTool } from "@copilotkit/react-core";',
    v2: 'import { useFrontendTool } from "@copilotkit/react-core/v2";',
    source: "packages/react-core/src/v2/hooks/use-frontend-tool.tsx",
    docs: "https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool",
    notes: [
      "The v2 API uses a Zod schema instead of the v1 Parameter[] shape.",
    ],
  },
  {
    file: "packages/react-core/src/hooks/use-human-in-the-loop.ts",
    v1: 'import { useHumanInTheLoop } from "@copilotkit/react-core";',
    v2: 'import { useHumanInTheLoop } from "@copilotkit/react-core/v2";',
    source: "packages/react-core/src/v2/hooks/use-human-in-the-loop.tsx",
    docs: "https://docs.copilotkit.ai/reference/v2/hooks/useHumanInTheLoop",
    notes: [
      "The v2 API uses a Zod schema instead of the v1 Parameter[] shape.",
    ],
  },
  {
    file: "packages/react-core/src/hooks/use-render-tool-call.ts",
    v1: 'import { useRenderToolCall } from "@copilotkit/react-core";',
    v2: 'import { useFrontendTool } from "@copilotkit/react-core/v2";',
    source: "packages/react-core/src/v2/hooks/use-frontend-tool.tsx",
    docs: "https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool",
    notes: [
      "There is no 1:1 replacement. V2 useRenderToolCall has different semantics.",
      "Use useFrontendTool or useHumanInTheLoop to register a renderer in v2.",
    ],
  },
  {
    file: "packages/react-core/src/hooks/use-copilot-readable.ts",
    v1: 'import { useCopilotReadable } from "@copilotkit/react-core";',
    v2: 'import { useAgentContext } from "@copilotkit/react-core/v2";',
    source: "packages/react-core/src/v2/hooks/use-agent-context.tsx",
    docs: "https://docs.copilotkit.ai/reference/v2/hooks/useAgentContext",
    notes: ["V2 models readable application state as agent context."],
  },
  {
    file: "packages/react-core/src/hooks/use-langgraph-interrupt.ts",
    v1: 'import { useLangGraphInterrupt } from "@copilotkit/react-core";',
    v2: 'import { useInterrupt } from "@copilotkit/react-core/v2";',
    source: "packages/react-core/src/v2/hooks/use-interrupt.tsx",
    docs: "https://docs.copilotkit.ai/reference/v2/hooks/useInterrupt",
    notes: ["Use the framework-neutral v2 interrupt API."],
  },
  {
    file: "packages/react-ui/src/hooks/use-copilot-chat-suggestions.tsx",
    v1: 'import { useCopilotChatSuggestions } from "@copilotkit/react-ui";',
    v2: 'import { useConfigureSuggestions } from "@copilotkit/react-core/v2";',
    source: "packages/react-core/src/v2/hooks/use-configure-suggestions.tsx",
    docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
    notes: ["This replacement moves from react-ui to react-core/v2."],
  },
  {
    file: "packages/react-ui/src/components/chat/Chat.tsx",
    v1: 'import { CopilotChat } from "@copilotkit/react-ui";',
    v2: 'import { CopilotChat } from "@copilotkit/react-core/v2";',
    source: "packages/react-core/src/v2/components/chat/CopilotChat.tsx",
    docs: "https://docs.copilotkit.ai/reference/v2/components/CopilotChat",
    notes: [
      "V2 chat components and styles move from react-ui to react-core/v2.",
      'Replace the stylesheet import with "@copilotkit/react-core/v2/styles.css".',
    ],
  },
  {
    file: "packages/runtime/src/lib/runtime/copilot-runtime.ts",
    v1: 'import { CopilotRuntime } from "@copilotkit/runtime";',
    v2: 'import { CopilotRuntime } from "@copilotkit/runtime/v2";',
    source: "packages/runtime/src/v2/runtime/core/runtime.ts",
    docs: "https://docs.copilotkit.ai/runtime-server-adapter",
    notes: [
      "V2 uses AG-UI runtime handlers instead of the v1 GraphQL adapter setup.",
    ],
  },
];
