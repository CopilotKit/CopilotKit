export * from "../service-adapters/openai/openai-adapter";
export * from "../service-adapters/langchain/langchain-adapter";
export * from "../service-adapters/google/google-genai-adapter";
export * from "../service-adapters/openai/openai-assistant-adapter";
export * from "../service-adapters/unify/unify-adapter";
export * from "../service-adapters/groq/groq-adapter";
export * from "./integrations";
export * from "./logger";
export * from "./runtime/copilot-runtime";
export * from "./runtime/mcp-tools-utils";

/**
 * The below is a temporary workaround to allow LangGraphAgent and LangGraphHttpAgent to be imported from "@copilotkit/runtime" without loading @ag-ui/langgraph.
 * The direct exports are deprecated and will be removed in a future release.
 * Please import from "@copilotkit/runtime/langgraph" instead.
 */

// Re-export types (these don't cause runtime loading)
export type { PredictStateTool, TextMessageEvents, ToolCallEvents } from "./runtime/agent-integrations/langgraph.agent";

// Re-export enum (enums are values, but CustomEventNames is just string constants - acceptable)
export { CustomEventNames } from "./runtime/agent-integrations/langgraph.agent";

// Lazy proxy exports for LangGraphAgent and LangGraphHttpAgent
// These avoid loading @ag-ui/langgraph until actually used
let _langgraphModule: typeof import("./runtime/agent-integrations/langgraph.agent") | null = null;
let _deprecationWarned = false;

function getLanggraphModule() {
  if (!_langgraphModule) {
    if (!_deprecationWarned) {
      _deprecationWarned = true;
      console.warn(
        '[CopilotKit] Importing LangGraphAgent or LangGraphHttpAgent from "@copilotkit/runtime" is deprecated. ' +
        'Please import from "@copilotkit/runtime/langgraph" instead.'
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _langgraphModule = require("./runtime/agent-integrations/langgraph.agent");
  }
  return _langgraphModule!;
}

export const LangGraphAgent = new Proxy(function () {}, {
  construct(_, args: any[]) {
    const Cls = getLanggraphModule().LangGraphAgent;
    return new Cls(...(args as [any]));
  },
  get(_, prop) {
    return (getLanggraphModule().LangGraphAgent as any)[prop];
  },
}) as unknown as typeof import("./runtime/agent-integrations/langgraph.agent").LangGraphAgent;

export const LangGraphHttpAgent = new Proxy(function () {}, {
  construct(_, args: any[]) {
    const Cls = getLanggraphModule().LangGraphHttpAgent;
    return new Cls(...(args as [any]));
  },
  get(_, prop) {
    return (getLanggraphModule().LangGraphHttpAgent as any)[prop];
  },
}) as unknown as typeof import("./runtime/agent-integrations/langgraph.agent").LangGraphHttpAgent;
