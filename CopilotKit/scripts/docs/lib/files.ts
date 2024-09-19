import { ReferenceDocConfiguration } from "./reference-doc";

export const REFERENCE_DOCS: ReferenceDocConfiguration[] = [
  {
    sourcePath: "packages/runtime/src/service-adapters/google/google-genai-adapter.ts",
    destinationPath:
      "docs/pages/reference/classes/CopilotRuntime/service-adapters/GoogleGenerativeAIAdapter.mdx",
    className: "GoogleGenerativeAIAdapter",
  },
  {
    sourcePath: "packages/runtime/src/service-adapters/groq/groq-adapter.ts",
    destinationPath: "docs/pages/reference/classes/CopilotRuntime/service-adapters/GroqAdapter.mdx",
    className: "GroqAdapter",
  },
  {
    sourcePath: "packages/runtime/src/service-adapters/langchain/langchain-adapter.ts",
    destinationPath:
      "docs/pages/reference/classes/CopilotRuntime/service-adapters/LangchainAdapter.mdx",
    className: "LangChainAdapter",
  },
  {
    sourcePath: "packages/runtime/src/service-adapters/openai/openai-adapter.ts",
    destinationPath:
      "docs/pages/reference/classes/CopilotRuntime/service-adapters/OpenAIAdapter.mdx",
    className: "OpenAIAdapter",
  },
  {
    sourcePath: "packages/runtime/src/service-adapters/openai/openai-assistant-adapter.ts",
    destinationPath:
      "docs/pages/reference/classes/CopilotRuntime/service-adapters/OpenAIAssistantAdapter.mdx",
    className: "OpenAIAssistantAdapter",
  },
  {
    sourcePath: "packages/runtime/src/service-adapters/anthropic/anthropic-adapter.ts",
    destinationPath:
      "docs/pages/reference/classes/CopilotRuntime/service-adapters/AnthropicAdapter.mdx",
    className: "AnthropicAdapter",
  },
  {
    sourcePath: "packages/react-core/src/lib/copilot-task.ts",
    destinationPath: "docs/pages/reference/classes/CopilotTask.mdx",
    className: "CopilotTask",
  },
  {
    sourcePath: "packages/runtime/src/lib/copilot-runtime.ts",
    destinationPath: "docs/pages/reference/classes/CopilotRuntime/CopilotRuntime.mdx",
    className: "CopilotRuntime",
  },
  {
    sourcePath: "packages/react-ui/src/components/chat/Chat.tsx",
    destinationPath: "docs/pages/reference/components/CopilotChat.mdx",
    component: "CopilotChat",
  },
  {
    sourcePath: "packages/react-core/src/components/copilot-provider/copilotkit.tsx",
    destinationPath: "docs/pages/reference/components/CopilotKit.mdx",
    component: "CopilotKit",
  },
  {
    sourcePath: "packages/react-ui/src/components/chat/Popup.tsx",
    destinationPath: "docs/pages/reference/components/CopilotPopup.mdx",
    component: "CopilotPopup",
  },
  {
    sourcePath: "packages/react-ui/src/components/chat/Sidebar.tsx",
    destinationPath: "docs/pages/reference/components/CopilotSidebar.mdx",
    component: "CopilotSidebar",
  },
  {
    sourcePath: "packages/react-textarea/src/components/copilot-textarea/copilot-textarea.tsx",
    destinationPath: "docs/pages/reference/components/CopilotTextarea.mdx",
    component: "CopilotTextarea",
  },
  {
    sourcePath: "packages/react-core/src/hooks/use-copilot-chat.ts",
    destinationPath: "docs/pages/reference/hooks/useCopilotChat.mdx",
    hook: "useCopilotChat",
  },
  {
    sourcePath: "packages/react-ui/src/hooks/use-copilot-chat-suggestions.tsx",
    destinationPath: "docs/pages/reference/hooks/useCopilotChatSuggestions.mdx",
    hook: "useCopilotChatSuggestions",
  },
  {
    sourcePath: "packages/react-core/src/hooks/use-copilot-readable.ts",
    destinationPath: "docs/pages/reference/hooks/useCopilotReadable.mdx",
    hook: "useCopilotReadable",
  },
];
