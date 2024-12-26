/**
 * CopilotKit Empty Adapter
 *
 * This adapter does nothing
 * Ideal if you want to be sure your front-end doesn't connect to any 3rd party LLM,
 * except your GraphLang chain.
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
        return {
            threadId: request.threadId || randomId(),
        };
    }
}