import http from "http";
import {
  AnnotatedFunction,
  annotatedFunctionToChatCompletionFunction,
  ToolDefinition,
  EXCLUDE_FROM_FORWARD_PROPS_KEYS,
} from "@copilotkit/shared";
import { copilotkitStreamInterceptor, remoteChainToAnnotatedFunction } from "../utils";
import { RemoteChain, CopilotKitServiceAdapter } from "../types";

interface CopilotBackendConstructorParams {
  actions?: AnnotatedFunction<any[]>[];
  langserve?: RemoteChain[];
  debug?: boolean;
}

interface CopilotBackendResult {
  stream: ReadableStream;
  headers?: Record<string, string>;
}

export class CopilotBackend {
  private functions: AnnotatedFunction<any[]>[] = [];
  private langserve: Promise<AnnotatedFunction<any[]>>[] = [];
  private debug: boolean = false;

  constructor(params?: CopilotBackendConstructorParams) {
    for (const action of params?.actions || []) {
      this.functions.push(action);
    }
    for (const chain of params?.langserve || []) {
      this.langserve.push(remoteChainToAnnotatedFunction(chain));
    }
    this.debug = params?.debug || false;
  }

  addFunction(func: AnnotatedFunction<any[]>): void {
    this.removeFunction(func.name);
    this.functions.push(func);
  }

  removeFunction(funcName: string): void {
    this.functions = this.functions.filter((f) => f.name !== funcName);
  }

  removeBackendOnlyProps(forwardedProps: any): void {
    // Get keys backendOnlyPropsKeys in order to remove them from the forwardedProps
    const backendOnlyPropsKeys = forwardedProps[EXCLUDE_FROM_FORWARD_PROPS_KEYS];
    if (Array.isArray(backendOnlyPropsKeys)) {
      backendOnlyPropsKeys.forEach((key) => {
        const success = Reflect.deleteProperty(forwardedProps, key);
        if (!success) {
          console.error(`Failed to delete property ${key}`);
        }
      });
      // After deleting individual backend-only properties, delete the EXCLUDE_FROM_FORWARD_PROPS_KEYS property itself from forwardedProps
      const success = Reflect.deleteProperty(forwardedProps, EXCLUDE_FROM_FORWARD_PROPS_KEYS);
      if (!success) {
        console.error(`Failed to delete EXCLUDE_FROM_FORWARD_PROPS_KEYS`);
      }
    } else if (backendOnlyPropsKeys) {
      console.error("backendOnlyPropsKeys is not an array");
    }
  }
  async stream(
    forwardedProps: any,
    serviceAdapter: CopilotKitServiceAdapter,
  ): Promise<CopilotBackendResult> {
    this.removeBackendOnlyProps(forwardedProps);
    const langserveFunctions: AnnotatedFunction<any[]>[] = [];

    for (const chainPromise of this.langserve) {
      try {
        const chain = await chainPromise;
        langserveFunctions.push(chain);
      } catch (error) {
        console.error("Error loading langserve chain:", error);
      }
    }

    // merge server side functions with langserve functions
    let mergedTools = mergeServerSideTools(
      this.functions.map(annotatedFunctionToChatCompletionFunction),
      langserveFunctions.map(annotatedFunctionToChatCompletionFunction),
    );

    // merge with client side functions
    mergedTools = mergeServerSideTools(mergedTools, forwardedProps.tools);

    const result = await serviceAdapter.stream({
      ...forwardedProps,
      tools: mergedTools,
    });

    if ("getReader" in result) {
      const stream = copilotkitStreamInterceptor(
        result,
        [...this.functions, ...langserveFunctions],
        this.debug,
      );
      return { stream };
    } else {
      const stream = copilotkitStreamInterceptor(
        result.stream,
        [...this.functions, ...langserveFunctions],
        this.debug,
      );
      return { stream, headers: result.headers };
    }
  }

  async response(req: Request, serviceAdapter: CopilotKitServiceAdapter): Promise<Response> {
    try {
      const result = await this.stream(await req.json(), serviceAdapter);
      return new Response(result.stream, { headers: result.headers });
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
    const result = await this.stream(forwardedProps, serviceAdapter);
    const reader = result.stream.getReader();
    if (result.headers) {
      res.writeHead(200, result.headers);
    }

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

export function mergeServerSideTools(
  serverTools: ToolDefinition[],
  clientTools?: ToolDefinition[],
) {
  let allTools: ToolDefinition[] = serverTools.slice();
  const serverToolsNames = serverTools.map((tool) => tool.function.name);
  if (clientTools) {
    allTools = allTools.concat(
      // filter out any client functions that are already defined on the server
      clientTools.filter((tool: ToolDefinition) => !serverToolsNames.includes(tool.function.name)),
    );
  }
  return allTools;
}
