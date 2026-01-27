/**
 * Copilot Runtime adapter for AWS Bedrock.
 *
 * ## Example
 *
 * ```ts
 * import { CopilotRuntime, BedrockAdapter } from "@copilotkit/runtime";
 *
 * const copilotKit = new CopilotRuntime();
 *
 * return new BedrockAdapter({
 *   model: "amazon.nova-lite-v1:0",
 *   region: "us-east-1",
 *   credentials: {
 *     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
 *     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
 *   }
 * });
 * ```
 */

import { LangChainAdapter } from "../langchain/langchain-adapter";

export interface BedrockAdapterParams {
  /**
   * AWS Bedrock model ID to use.
   * @default "amazon.nova-lite-v1:0"
   */
  model?: string;

  /**
   * AWS region where Bedrock is available.
   * @default "us-east-1"
   */
  region?: string;

  /**
   * AWS credentials for Bedrock access.
   */
  credentials?: {
    accessKeyId?: string;
    secretAccessKey?: string;
  };
}

const DEFAULT_MODEL = "amazon.nova-lite-v1:0";

export class BedrockAdapter extends LangChainAdapter {
  public provider = "bedrock";
  public model: string = DEFAULT_MODEL;
  constructor(options?: BedrockAdapterParams) {
    super({
      chainFn: async ({ messages, tools, threadId }) => {
        // Lazy require for optional peer dependency
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ChatBedrockConverse } = require("@langchain/aws");

        this.model = options?.model ?? "amazon.nova-lite-v1:0";
        const model = new ChatBedrockConverse({
          model: this.model,
          region: options?.region ?? "us-east-1",
          credentials: options?.credentials
            ? {
                accessKeyId: options.credentials.accessKeyId,
                secretAccessKey: options.credentials.secretAccessKey,
              }
            : undefined,
        }).bindTools(tools);
        return model.stream(messages);
      },
    });
  }
}
