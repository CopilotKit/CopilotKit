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
 * import { CopilotRuntime, EmptyAdapter } from "@copilotkit/runtime";
 *
 * const copilotKit = new CopilotRuntime();
 *
 * return new EmptyAdapter();
 * ```
 */
import {
  CopilotServiceAdapter,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";
import { randomUUID } from "@copilotkit/shared";

export class EmptyAdapter implements CopilotServiceAdapter {
  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    return {
      threadId: request.threadId || randomUUID(),
    };
  }
}

export const ExperimentalEmptyAdapter = EmptyAdapter;
