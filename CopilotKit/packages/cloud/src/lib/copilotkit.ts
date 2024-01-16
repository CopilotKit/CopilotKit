import { CopilotKitServiceAdapter, CopilotKitOpenAIConfiguration } from "../types";
import { OpenAIAdapter } from "./openai-adapter";

type CopilotKitConstructorParams = CopilotKitOpenAIConfiguration;
// add other configuration types here
// | LangChainConfiguration;

export class CopilotKit {
  private serviceAdapter!: CopilotKitServiceAdapter;

  constructor(params: CopilotKitConstructorParams) {
    if (params.provider === undefined || params.provider === "openai") {
      this.serviceAdapter = new OpenAIAdapter(params);
    }
  }

  stream() {}
}
