import { AnnotatedFunction } from "@copilotkit/shared";
import { CopilotKitServiceAdapter } from "../types";
import { OpenAIAdapter } from "./openai-adapter";

interface CopilotKitConstructorParams {
  functions?: AnnotatedFunction<any[]>[];
}

export class CopilotKitBackend {
  private functions: AnnotatedFunction<any[]>[] = [];

  constructor(params?: CopilotKitConstructorParams) {
    this.functions = params?.functions || [];
  }

  addFunction(func: AnnotatedFunction<any[]>): void {
    this.removeFunction(func.name);
    this.functions.push(func);
  }

  removeFunction(funcName: string): void {
    this.functions = this.functions.filter((f) => f.name !== funcName);
  }

  stream(
    forwardedProps: any,
    serviceAdapter: CopilotKitServiceAdapter = new OpenAIAdapter(),
  ): ReadableStream {
    return serviceAdapter.stream(this.functions, forwardedProps);
  }

  async response(
    req: Request,
    serviceAdapter: CopilotKitServiceAdapter = new OpenAIAdapter(),
  ): Promise<Response> {
    try {
      return new Response(this.stream(await req.json(), serviceAdapter));
    } catch (error: any) {
      return new Response("", { status: 500, statusText: error.error.message });
    }
  }
}
