export const pilotMappings = [
  {
    file: "packages/react-core/src/hooks/use-frontend-tool.ts",
    v1: 'import { useFrontendTool } from "@copilotkit/react-core";',
    v2: 'import { useFrontendTool } from "@copilotkit/react-core/v2";',
    source: "packages/react-core/src/v2/hooks/use-frontend-tool.tsx",
    docs: "https://docs.copilotkit.ai/reference/v2/hooks/useFrontendTool",
    deprecatedExport: "useFrontendTool",
    deprecationGuidance:
      "Use `useFrontendTool` from `@copilotkit/react-core/v2` instead.",
    baselineHash:
      "2012ac1d00c567bf031c3ef1140503c9ffd473bcf83ac06a404c7d00fd08d751",
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
    deprecatedExport: "useHumanInTheLoop",
    deprecationGuidance:
      "Use `useHumanInTheLoop` from `@copilotkit/react-core/v2` instead.",
    baselineHash:
      "1c30d48bc18106bec473e6f28e039aab787ceb25e093025b73324b53545b2a76",
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
    deprecatedExport: "useRenderToolCall",
    deprecationGuidance:
      "Use `useFrontendTool` or `useHumanInTheLoop` from `@copilotkit/react-core/v2` instead.",
    baselineHash:
      "470c524bbe576cc8ef4c855f8965bf83bfe1e81d219b496386e5760b729343ce",
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
    deprecatedExport: "useCopilotReadable",
    deprecationGuidance:
      "Use `useAgentContext` from `@copilotkit/react-core/v2` instead.",
    baselineHash:
      "a33ac0247fbf4ca6b4e3ed1c77f5aa4d6b874bac62fd06b3f86950f694487eb2",
    notes: ["V2 models readable application state as agent context."],
  },
  {
    file: "packages/react-core/src/hooks/use-langgraph-interrupt.ts",
    v1: 'import { useLangGraphInterrupt } from "@copilotkit/react-core";',
    v2: 'import { useInterrupt } from "@copilotkit/react-core/v2";',
    source: "packages/react-core/src/v2/hooks/use-interrupt.tsx",
    docs: "https://docs.copilotkit.ai/reference/v2/hooks/useInterrupt",
    deprecatedExport: "useLangGraphInterrupt",
    deprecationGuidance:
      "Use `useInterrupt` from `@copilotkit/react-core/v2` instead.",
    baselineHash:
      "ca913337d0e2eb27dfb9c9018c364dd44738cea5d0252572689fbb012ee37953",
    notes: ["Use the framework-neutral v2 interrupt API."],
  },
  {
    file: "packages/react-ui/src/hooks/use-copilot-chat-suggestions.tsx",
    v1: 'import { useCopilotChatSuggestions } from "@copilotkit/react-ui";',
    v2: 'import { useConfigureSuggestions } from "@copilotkit/react-core/v2";',
    source: "packages/react-core/src/v2/hooks/use-configure-suggestions.tsx",
    docs: "https://docs.copilotkit.ai/reference/v2/hooks/useConfigureSuggestions",
    deprecatedExport: "useCopilotChatSuggestions",
    deprecationGuidance:
      "Use `useConfigureSuggestions` from `@copilotkit/react-core/v2` instead.",
    baselineHash:
      "ec7c54a928bf5397ff1f093e0f11d641e410f3a0e4fc24a912a257e9a1a2b6f8",
    notes: ["This replacement moves from react-ui to react-core/v2."],
  },
  {
    file: "packages/react-ui/src/components/chat/Chat.tsx",
    v1: 'import { CopilotChat } from "@copilotkit/react-ui";',
    v2: 'import { CopilotChat } from "@copilotkit/react-core/v2";',
    source: "packages/react-core/src/v2/components/chat/CopilotChat.tsx",
    docs: "https://docs.copilotkit.ai/reference/v2/components/CopilotChat",
    deprecatedExport: "CopilotChat",
    deprecationGuidance:
      "Use `CopilotChat` from `@copilotkit/react-core/v2` instead.",
    baselineHash:
      "83f150648637705a48591b1e3e23e5f0b58bcf2e42d3f3dc9463a5f280528f6f",
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
    deprecatedExport: "CopilotRuntime",
    deprecationGuidance:
      "Use `CopilotRuntime` from `@copilotkit/runtime/v2` instead.",
    baselineHash:
      "0790657078be9014c49eadef755c713fe30f469f0192a65d0ca004e470fa1a47",
    notes: [
      "V2 uses AG-UI runtime handlers instead of the v1 GraphQL adapter setup.",
    ],
  },
];
