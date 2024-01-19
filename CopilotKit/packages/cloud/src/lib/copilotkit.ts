import { AnnotatedFunction } from "@copilotkit/shared";
import { CopilotKitServiceAdapter, CopilotKitOpenAIConfiguration } from "../types";
import { OpenAIAdapter } from "./openai-adapter";

type CopilotKitConstructorParams = CopilotKitOpenAIConfiguration;
// add other configuration types here
// | LangChainConfiguration;

export class CopilotKit {
  private serviceAdapter!: CopilotKitServiceAdapter;
  private functions: AnnotatedFunction<any[]>[] = [];

  constructor(params?: CopilotKitConstructorParams) {
    if (!params || params.provider === undefined || params.provider === "openai") {
      this.serviceAdapter = new OpenAIAdapter(params || {});
      if (params?.functions) {
        this.functions = params.functions;
      }
    }
  }

  stream(forwardedProps: any): ReadableStream {
    return this.serviceAdapter.stream(this.functions, forwardedProps);
  }
}
