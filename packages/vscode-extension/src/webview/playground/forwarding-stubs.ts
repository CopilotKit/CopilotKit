/**
 * A Proxy-backed module namespace for `@copilotkit/react-core/v2` that routes
 * a subset of exports to the real v2 package and falls through to capture-only
 * stubs for everything else — preserving Plan #2's TDZ-avoidance strategy.
 *
 * Known-real exports:
 *   - CopilotKit / CopilotKitProvider  (provider)
 *   - useCopilotKit / useAgent / useRenderToolCall  (used by PlaygroundChat
 *     to drive runs and render the user's registered tool components)
 *   - useFrontendTool / useComponent / useHumanInTheLoop  (tool registration)
 *   - useRenderTool / useRenderCustomMessages / useRenderActivityMessage
 *     / useDefaultRenderTool  (render hooks)
 *   - useInterrupt  (interrupt)
 *   - useAgentContext / useCapabilities / useSuggestions
 *     / useConfigureSuggestions / useThreads / useAttachments  (agent + data)
 *
 * `<CopilotChat />` and its sub-components are intentionally NOT here —
 * the playground ships its own minimal chat (PlaygroundChat) that drives
 * the runtime directly. See codegen/playground-chat-source.ts.
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
  // Hooks PlaygroundChat needs (use-*-* registry surface + send path)
  useCopilotKit,
  useAgent,
  useRenderToolCall,
  // Tool / action registration
  useFrontendTool,
  useComponent,
  useHumanInTheLoop,
  // Render hooks
  useRenderTool,
  useRenderCustomMessages,
  useRenderActivityMessage,
  useDefaultRenderTool,
  useInterrupt,
  // Agent + data
  useAgentContext,
  useCapabilities,
  useSuggestions,
  useConfigureSuggestions,
  useThreads,
  useAttachments,
} from "@copilotkit/react-core/v2";
import { createCopilotkitStubs } from "../hook-preview/copilotkit-stubs";

const REAL: Record<string, unknown> = {
  CopilotKit,
  CopilotKitProvider,
  useCopilotKit,
  useAgent,
  useRenderToolCall,
  useFrontendTool,
  useComponent,
  useHumanInTheLoop,
  useRenderTool,
  useRenderCustomMessages,
  useRenderActivityMessage,
  useDefaultRenderTool,
  useInterrupt,
  useAgentContext,
  useCapabilities,
  useSuggestions,
  useConfigureSuggestions,
  useThreads,
  useAttachments,
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
