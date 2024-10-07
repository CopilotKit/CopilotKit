import { ReferenceDocConfiguration } from "./reference-doc";

export const REFERENCE_DOCS: ReferenceDocConfiguration[] = [
  /* Runtime */
  {
    sourcePath: "packages/runtime/src/service-adapters/google/google-genai-adapter.ts",
    destinationPath:
      "docs/content/docs/reference/classes/llm-adapters/GoogleGenerativeAIAdapter.mdx",
    className: "GoogleGenerativeAIAdapter",
    description: "Copilot Runtime adapter for Google Generative AI (e.g. Gemini).",
  },
  {
    sourcePath: "packages/runtime/src/service-adapters/groq/groq-adapter.ts",
    destinationPath: "docs/content/docs/reference/classes/llm-adapters/GroqAdapter.mdx",
    className: "GroqAdapter",
    description: "Copilot Runtime adapter for Groq.",
  },
  {
    sourcePath: "packages/runtime/src/service-adapters/langchain/langchain-adapter.ts",
    destinationPath: "docs/content/docs/reference/classes/llm-adapters/LangChainAdapter.mdx",
    className: "LangChainAdapter",
    description: "Copilot Runtime adapter for LangChain.",
  },
  {
    sourcePath: "packages/runtime/src/service-adapters/openai/openai-adapter.ts",
    destinationPath: "docs/content/docs/reference/classes/llm-adapters/OpenAIAdapter.mdx",
    className: "OpenAIAdapter",
    description: "Copilot Runtime adapter for OpenAI.",
  },
  {
    sourcePath: "packages/runtime/src/service-adapters/openai/openai-assistant-adapter.ts",
    destinationPath:
      "docs/content/docs/reference/classes/llm-adapters/OpenAIAssistantAdapter.mdx",
    className: "OpenAIAssistantAdapter",
    description: "Copilot Runtime adapter for OpenAI Assistant API.",
  },
  {
    sourcePath: "packages/runtime/src/service-adapters/anthropic/anthropic-adapter.ts",
    destinationPath: "docs/content/docs/reference/classes/llm-adapters/AnthropicAdapter.mdx",
    className: "AnthropicAdapter",
    description: "Copilot Runtime adapter for Anthropic.",
  },
  /* Classes */
  {
    sourcePath: "packages/react-core/src/lib/copilot-task.ts",
    destinationPath: "docs/content/docs/reference/classes/CopilotTask.mdx",
    className: "CopilotTask",
    description: "CopilotTask is used to execute one-off tasks, for example on button click.",
  },
  {
    sourcePath: "packages/runtime/src/lib/runtime/copilot-runtime.ts",
    destinationPath: "docs/content/docs/reference/classes/CopilotRuntime.mdx",
    className: "CopilotRuntime",
    description:
      "Copilot Runtime is the back-end component of CopilotKit, enabling interaction with LLMs.",
  },
  /* Components */
  {
    sourcePath: "packages/react-ui/src/components/chat/Chat.tsx",
    destinationPath: "docs/content/docs/reference/components/chat/CopilotChat.mdx",
    component: "CopilotChat",
    description:
      "The CopilotChat component, providing a chat interface for interacting with your copilot.",
  },
  {
    sourcePath: "packages/react-core/src/components/copilot-provider/copilotkit.tsx",
    destinationPath: "docs/content/docs/reference/components/CopilotKit.mdx",
    component: "CopilotKit",
    description: "The CopilotKit provider component, wrapping your application.",
  },
  {
    sourcePath: "packages/react-ui/src/components/chat/Popup.tsx",
    destinationPath: "docs/content/docs/reference/components/chat/CopilotPopup.mdx",
    component: "CopilotPopup",
    description:
      "The CopilotPopup component, providing a popup interface for interacting with your copilot.",
  },
  {
    sourcePath: "packages/react-ui/src/components/chat/Sidebar.tsx",
    destinationPath: "docs/content/docs/reference/components/chat/CopilotSidebar.mdx",
    component: "CopilotSidebar",
    description:
      "The CopilotSidebar component, providing a sidebar interface for interacting with your copilot.",
  },
  {
    sourcePath: "packages/react-textarea/src/components/copilot-textarea/copilot-textarea.tsx",
    destinationPath: "docs/content/docs/reference/components/CopilotTextarea.mdx",
    component: "CopilotTextarea",
    description:
      "An AI-powered textarea component for your application, which serves as a drop-in replacement for any textarea.",
  },
  /* Hooks */
  {
    sourcePath: "packages/react-core/src/hooks/use-copilot-chat.ts",
    destinationPath: "docs/content/docs/reference/hooks/useCopilotChat.mdx",
    hook: "useCopilotChat",
  },
  {
    sourcePath: "packages/react-ui/src/hooks/use-copilot-chat-suggestions.tsx",
    destinationPath: "docs/content/docs/reference/hooks/useCopilotChatSuggestions.mdx",
    hook: "useCopilotChatSuggestions",
    description:
      "The useCopilotChatSuggestions hook generates suggestions in the chat window based on real-time app state.",
  },
  {
    sourcePath: "packages/react-core/src/hooks/use-copilot-readable.ts",
    destinationPath: "docs/content/docs/reference/hooks/useCopilotReadable.mdx",
    hook: "useCopilotReadable",
    description:
      "The useCopilotReadable hook allows you to provide knowledge to your copilot (e.g. application state).",
  },
];
