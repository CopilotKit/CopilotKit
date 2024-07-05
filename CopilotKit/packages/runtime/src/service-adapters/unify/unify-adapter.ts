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
 * To use your custom Unify instance, pass the `unify` property.
 * ```jsx
 * const unify = new Unify({
 *   apiKey: "your-api-key"
 * });
 *
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new Unify({ unify }),
 * );
 * ```
 *
 */
import { OpenAIAdapter, OpenAIAdapterParams } from "./openai-adapter";
import { CopilotKitResponse, CopilotKitServiceAdapter } from "../types/service-adapter";

const UNIFY_BASE_URL = "https://api.unify.ai/v0/chat/completions";

export class UnifyAdapter implements CopilotKitServiceAdapter {
  private openaiAdapter: OpenAIAdapter;

  constructor(params?: OpenAIAdapterParams) {
    this.openaiAdapter = new OpenAIAdapter(params);
  }

  async getResponse(forwardedProps: any): Promise<CopilotKitResponse> {
    // Create a copy of forwardedProps to avoid modifying the original object
    const unifyProps = { ...forwardedProps };

    // Replace the base URL with the Unify URL
    unifyProps.baseUrl = UNIFY_BASE_URL;

    // Call the OpenAIAdapter's getResponse method with the modified props
    return this.openaiAdapter.getResponse(unifyProps);
  }
}
