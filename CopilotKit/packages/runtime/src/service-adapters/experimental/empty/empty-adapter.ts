/**
 * CopilotKit Empty Adapter
 *
 * This adapter is meant to preserve adherence to runtime requirements, while doing nothing
 * Ideal if you don't want to connect an LLM the to the runtime, and only use your LangGraph agent.
 * Be aware that Copilot Suggestions will not work if you use this adapter
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, ExperimentalEmptyAdapter } from "@copilotkit/runtime";
 *
 * const copilotKit = new CopilotRuntime();
 *
 * return new ExperimentalEmptyAdapter();
 * ```
 */
import {
  CopilotServiceAdapter,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../../service-adapter";
import { randomId } from "@copilotkit/shared";

export class ExperimentalEmptyAdapter implements CopilotServiceAdapter {
  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    return {};
  }
}
