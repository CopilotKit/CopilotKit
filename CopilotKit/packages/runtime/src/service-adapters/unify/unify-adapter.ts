/**
 * CopilotRuntime Adapter for Unify.
 *
 * <RequestExample>
 * ```jsx CopilotRuntime Example
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(req, new UnifyAdapter());
 * ```
 * </RequestExample>
 *
 * You can easily set the model to use by passing it to the constructor.
 * ```jsx
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new UnifyAdapter({ model: "llama-3-70b-chat@together-ai" }),
 * );
 * ```
 *
 * To use a custom OpenAI instance, pass the `openai` property.
 * ```jsx
 * const unifyOpenAi = new OpenAI({
 *   apiKey: "your-api-key"
 * });
 *
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new UnifyAdapter({ openai: unifyOpenAi }),
 * );
 * ```
 *
 */
import { OpenAIAdapter, OpenAIAdapterParams } from "../openai/openai-adapter";
import {
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
  CopilotServiceAdapter,
} from "../service-adapter";

const UNIFY_BASE_URL = "https://api.unify.ai/v0/chat/completions";
const UNIFY_API_KEY = "UNIFY_API_KEY";

export interface UnifyAdapterParams extends OpenAIAdapterParams {
  apiKey?: string;
}

export class UnifyAdapter implements CopilotServiceAdapter {
  private openaiAdapter: OpenAIAdapter;

  constructor(params?: UnifyAdapterParams) {
    this.openaiAdapter = new OpenAIAdapter(params);
    this.openaiAdapter.openai.baseURL = UNIFY_BASE_URL;

    const unifyApiKeyOverride: string | undefined = process.env[UNIFY_API_KEY] || params?.apiKey;
    if (unifyApiKeyOverride) {
      this.openaiAdapter.openai.apiKey = unifyApiKeyOverride;
    }
  }

  process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    return this.openaiAdapter.process(request);
  }
}
