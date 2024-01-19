import { AnnotatedFunction } from "@copilotkit/shared";
import { CopilotKitServiceAdapter } from "../types";
import { OpenAIAdapter } from "./openai-adapter";

interface CopilotKitConstructorParams {
  functions?: AnnotatedFunction<any[]>[];
}

export class CopilotKit {
  private functions: AnnotatedFunction<any[]>[] = [];

  constructor(params?: CopilotKitConstructorParams) {
    this.functions = params?.functions || [];
  }

  stream(
    forwardedProps: any,
    serviceAdapter: CopilotKitServiceAdapter = new OpenAIAdapter(),
  ): ReadableStream {
    return serviceAdapter.stream(this.functions, forwardedProps);
  }
}
