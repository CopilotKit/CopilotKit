import http from "http";
import stream from "stream";
import { AnnotatedFunction } from "@copilotkit/shared";
import { CopilotKitServiceAdapter } from "../types";
import { nodeServerParseJSONBody } from "../utils/node-http-server";

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

  async writeHttpServerResponse(
    req: http.ClientRequest,
    res: http.ServerResponse,
    serviceAdapter: CopilotKitServiceAdapter,
  ) {
    const forwardedProps = await nodeServerParseJSONBody(req);
    const webStream = this.stream(forwardedProps, serviceAdapter);
    // we get a type error here that can be ignored
    stream.Readable.fromWeb(webStream as any).pipe(res);
  }
}
