import { AnnotatedFunction } from "@copilotkit/shared";
import { CopilotKitServiceAdapter } from "../types";

interface CopilotBackendConstructorParams {
  functions?: AnnotatedFunction<any[]>[];
}

export class CopilotBackend {
  private functions: AnnotatedFunction<any[]>[] = [];

  constructor(params?: CopilotBackendConstructorParams) {
    this.functions = params?.functions || [];
  }

  addFunction(func: AnnotatedFunction<any[]>): void {
    this.removeFunction(func.name);
    this.functions.push(func);
  }

  removeFunction(funcName: string): void {
    this.functions = this.functions.filter((f) => f.name !== funcName);
  }

  stream(forwardedProps: any, serviceAdapter: CopilotKitServiceAdapter): ReadableStream {
    return serviceAdapter.stream(this.functions, forwardedProps);
  }

  async response(req: Request, serviceAdapter: CopilotKitServiceAdapter): Promise<Response> {
    try {
      return new Response(this.stream(await req.json(), serviceAdapter));
    } catch (error: any) {
      return new Response("", { status: 500, statusText: error.error.message });
    }
  }
}
