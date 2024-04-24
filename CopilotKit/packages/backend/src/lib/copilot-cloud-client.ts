import {
  COPILOT_CLOUD_API_URL,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
  CopilotCloudConfig,
  Message,
} from "@copilotkit/shared";

export interface CloudCheckGuardrailsInputParams {
  cloud: CopilotCloudConfig;
  publicApiKey: string;
  messages: Message[];
}

export interface CloudCheckGuardrailsInputResponse {
  status: "allowed" | "denied";
  reason: string;
}

export abstract class CopilotCloudClient {
  abstract checkGuardrailsInput(
    params: CloudCheckGuardrailsInputParams,
  ): Promise<CloudCheckGuardrailsInputResponse>;
}

export class DefaultCopilotCloudClient extends CopilotCloudClient {
  constructor(private readonly cloudApiUrl: string = COPILOT_CLOUD_API_URL) {
    super();
  }

  async checkGuardrailsInput({
    cloud,
    publicApiKey,
    messages,
  }: CloudCheckGuardrailsInputParams): Promise<CloudCheckGuardrailsInputResponse> {
    const url = `${this.cloudApiUrl}/copilotkit/guardrails/input`;

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: publicApiKey,
      },
      body: JSON.stringify({ messages, cloud }),
    });

    if (!response.ok) {
      let message = response.statusText;

      // try to parse the response body for a more detailed error message
      try {
        const json = await response.json();
        if (json.message) {
          message = json.message;
        }
      } catch (error) {}

      throw new Error("Failed to check input guardrails: " + message);
    }
    const json = await response.json();
    return { status: json.status, reason: json.reason };
  }
}
