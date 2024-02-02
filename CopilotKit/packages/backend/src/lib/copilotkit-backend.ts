import http from "http";
import {
  AnnotatedFunction,
  annotatedFunctionToChatCompletionFunction,
  Function,
} from "@copilotkit/shared";
import { CopilotKitServiceAdapter } from "../types";
import { copilotkitStreamInterceptor } from "../utils";

interface CopilotBackendConstructorParams {
  functions?: AnnotatedFunction<any[]>[];
  debug?: boolean;
}

export class CopilotBackend {
  private functions: AnnotatedFunction<any[]>[] = [];
  private debug: boolean = false;

  constructor(params?: CopilotBackendConstructorParams) {
    this.functions = params?.functions || [];
    this.debug = params?.debug || false;
  }

  addFunction(func: AnnotatedFunction<any[]>): void {
    this.removeFunction(func.name);
    this.functions.push(func);
  }

  removeFunction(funcName: string): void {
    this.functions = this.functions.filter((f) => f.name !== funcName);
  }

  async stream(
    forwardedProps: any,
    serviceAdapter: CopilotKitServiceAdapter,
  ): Promise<ReadableStream> {
    const mergedFunctions = mergeServerSideFunctions(
      this.functions.map(annotatedFunctionToChatCompletionFunction),
      forwardedProps.functions,
    );

    const openaiCompatibleStream = await serviceAdapter.stream({
      ...forwardedProps,
      functions: mergedFunctions,
    });
    return copilotkitStreamInterceptor(openaiCompatibleStream, this.functions, this.debug);
  }

  async response(req: Request, serviceAdapter: CopilotKitServiceAdapter): Promise<Response> {
    try {
      return new Response(await this.stream(await req.json(), serviceAdapter));
    } catch (error: any) {
      return new Response("", { status: 500, statusText: error.message });
    }
  }

  async streamHttpServerResponse(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    serviceAdapter: CopilotKitServiceAdapter,
  ) {
    const bodyParser = new Promise<any>((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk.toString()));
      req.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    const forwardedProps = await bodyParser;
    const stream = await this.stream(forwardedProps, serviceAdapter);
    const reader = stream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        break;
      } else {
        res.write(new TextDecoder().decode(value));
      }
    }
  }
}

export function mergeServerSideFunctions(serverFns: Function[], clientFns?: Function[]) {
  let allFunctions: Function[] = serverFns.slice();
  const serverFunctionNames = serverFns.map((fn) => fn.name);
  if (clientFns) {
    allFunctions = allFunctions.concat(
      // filter out any client functions that are already defined on the server
      clientFns.filter((fn: any) => !serverFunctionNames.includes(fn.name)),
    );
  }
  return allFunctions;
}
