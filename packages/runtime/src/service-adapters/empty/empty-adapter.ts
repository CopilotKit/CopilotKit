/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/runtime — EmptyAdapter:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/runtime — ExperimentalEmptyAdapter:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/runtime/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/runtime/src/service-adapters/empty/empty-adapter.ts
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

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
import type {
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
  public get name() {
    return "EmptyAdapter";
  }
}

export const ExperimentalEmptyAdapter = EmptyAdapter;
