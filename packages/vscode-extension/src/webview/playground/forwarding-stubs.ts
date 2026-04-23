/**
 * A Proxy-backed module namespace for `@copilotkit/react-core/v2` that routes
 * a subset of exports to the real v2 package and falls through to capture-only
 * stubs for everything else — preserving Plan #2's TDZ-avoidance strategy.
 *
 * Known-real exports (Plan #4):
 *   - CopilotKit / CopilotKitProvider  (provider)
 *   - useFrontendTool / useComponent / useHumanInTheLoop  (tool registration)
 *   - useRenderTool / useRenderToolCall / useRenderCustomMessages
 *     / useRenderActivityMessage / useDefaultRenderTool  (render hooks)
 *   - useInterrupt  (interrupt)
 *   - useAgent / useAgentContext / useCapabilities / useSuggestions
 *     / useConfigureSuggestions / useThreads / useAttachments  (agent + data)
 *   - CopilotChat / CopilotChatInput / CopilotChatMessageView
 *     / CopilotChatAssistantMessage  (chat UI)
 *
 * Note: useCopilotAction, useCopilotReadable, and useCopilotChat are v1 hooks
 * and are NOT exported from @copilotkit/react-core/v2. They remain capture-only
 * stubs.
 *
 * Using explicit named imports (not `import * as`) to avoid triggering rolldown's
 * namespace-walk, which would pull the entire transitive CJS dep graph and
 * risk TDZ errors from the chat/runtime-client-gql packages.
 */
import {
  // Provider + core
  CopilotKit,
  CopilotKitProvider,
  // Tool / action registration
  useFrontendTool,
  useComponent,
  useHumanInTheLoop,
  // Render hooks
  useRenderTool,
  useRenderToolCall,
  useRenderCustomMessages,
  useRenderActivityMessage,
  useDefaultRenderTool,
  useInterrupt,
  // Agent + data
  useAgent,
  useAgentContext,
  useCapabilities,
  useSuggestions,
  useConfigureSuggestions,
  useThreads,
  useAttachments,
  // Chat UI components
  CopilotChat,
  CopilotChatInput,
  CopilotChatMessageView,
  CopilotChatAssistantMessage,
} from "@copilotkit/react-core/v2";
import { createCopilotkitStubs } from "../hook-preview/copilotkit-stubs";

const REAL: Record<string, unknown> = {
  CopilotKit,
  CopilotKitProvider,
  useFrontendTool,
  useComponent,
  useHumanInTheLoop,
  useRenderTool,
  useRenderToolCall,
  useRenderCustomMessages,
  useRenderActivityMessage,
  useDefaultRenderTool,
  useInterrupt,
  useAgent,
  useAgentContext,
  useCapabilities,
  useSuggestions,
  useConfigureSuggestions,
  useThreads,
  useAttachments,
  CopilotChat,
  CopilotChatInput,
  CopilotChatMessageView,
  CopilotChatAssistantMessage,
};

export function createForwardingStubs(): Record<string, unknown> {
  const fallback = createCopilotkitStubs();
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        if (prop in REAL) return REAL[prop];
        return (fallback as Record<string, unknown>)[prop];
      },
      has() {
        return true;
      },
    },
  );
}
