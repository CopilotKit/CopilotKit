import {
  Action,
  ToolDefinition,
  EXCLUDE_FROM_FORWARD_PROPS_KEYS,
  actionToChatCompletionFunction,
  Parameter,
  AnnotatedFunction,
  annotatedFunctionToAction,
  COPILOT_CLOUD_PUBLIC_API_KEY_HEADER,
  CopilotCloudConfig,
} from "@copilotkit/shared";
import {
  SingleChunkReadableStream,
  copilotkitStreamInterceptor,
  remoteChainToAction,
} from "../utils";
import { RemoteChain, CopilotKitServiceAdapter } from "../types";
import { CopilotCloud, RemoteCopilotCloud } from "./copilot-cloud";

interface CopilotBackendResult {
  stream: ReadableStream;
  headers?: Record<string, string>;
}

interface CopilotBackendConstructorParams<T extends Parameter[] | [] = []> {
  actions?: Action<T>[];
  langserve?: RemoteChain[];
  debug?: boolean;
  copilotCloud?: CopilotCloud;
}

interface CopilotDeprecatedBackendConstructorParams<T extends Parameter[] | [] = []> {
  actions?: AnnotatedFunction<any>[];
  langserve?: RemoteChain[];
  debug?: boolean;
  copilotCloud?: CopilotCloud;
}

const CONTENT_POLICY_VIOLATION_RESPONSE =
  "Thank you for your request. Unfortunately, we're unable to fulfill it as it doesn't align with our content policy. We appreciate your understanding.";

export class CopilotBackend<const T extends Parameter[] | [] = []> {
  private actions: Action<any>[] = [];
  private langserve: Promise<Action<any>>[] = [];
  private debug: boolean = false;
  private copilotCloud: CopilotCloud;

  constructor(params?: CopilotBackendConstructorParams<T>);
  // @deprecated use Action<T> instead of AnnotatedFunction<T>
  constructor(params?: CopilotDeprecatedBackendConstructorParams<T>);
  constructor(
    params?: CopilotBackendConstructorParams<T> | CopilotDeprecatedBackendConstructorParams<T>,
  ) {
    for (const action of params?.actions || []) {
      if ("argumentAnnotations" in action) {
        this.actions.push(annotatedFunctionToAction(action));
      } else {
        this.actions.push(action);
      }
    }
    for (const chain of params?.langserve || []) {
      this.langserve.push(remoteChainToAction(chain));
    }
    this.debug = params?.debug || false;
    this.copilotCloud = params?.copilotCloud || new RemoteCopilotCloud();
  }

  addAction<const T extends Parameter[] | [] = []>(action: Action<T>): void;
  /** @deprecated Use addAction with Action<T> instead. */
  addAction(action: AnnotatedFunction<any>): void;
  addAction<const T extends Parameter[] | [] = []>(
    action: Action<T> | AnnotatedFunction<any>,
  ): void {
    this.removeAction(action.name);
    if ("argumentAnnotations" in action) {
      this.actions.push(annotatedFunctionToAction(action));
    } else {
      this.actions.push(action);
    }
  }

  removeAction(actionName: string): void {
    this.actions = this.actions.filter((f) => f.name !== actionName);
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

  private async getResponse(
    forwardedProps: any,
    serviceAdapter: CopilotKitServiceAdapter,
    publicApiKey?: string,
  ): Promise<CopilotBackendResult> {
    this.removeBackendOnlyProps(forwardedProps);

    // In case Copilot Cloud is configured remove it from the forwardedProps
    const cloud: CopilotCloudConfig = forwardedProps.cloud;
    delete forwardedProps.cloud;

    const langserveFunctions: Action<any>[] = [];

    for (const chainPromise of this.langserve) {
      try {
        const chain = await chainPromise;
        langserveFunctions.push(chain);
      } catch (error) {
        console.error("Error loading langserve chain:", error);
      }
    }

    const serversideTools: Action<any>[] = [...this.actions, ...langserveFunctions];
    const mergedTools = flattenToolCallsNoDuplicates([
      ...serversideTools.map(actionToChatCompletionFunction),
      ...forwardedProps.tools,
    ]);

    try {
      const result = await serviceAdapter.getResponse({
        ...forwardedProps,
        tools: mergedTools,
      });

      if (publicApiKey !== undefined) {
        // wait for the cloud log chat to finish before streaming back the response
        try {
          const checkGuardrailsInputResult = await this.copilotCloud.checkGuardrailsInput({
            cloud,
            publicApiKey,
            messages: forwardedProps.messages || [],
          });

          if (checkGuardrailsInputResult.status === "denied") {
            // the chat was denied. instead of streaming back the response,
            // we let the client know...
            return {
              stream: new SingleChunkReadableStream(checkGuardrailsInputResult.reason),
              headers: result.headers,
            };
          }
        } catch (error) {
          console.error("Error checking guardrails:", error);
        }
      }

      const stream = copilotkitStreamInterceptor(result.stream, serversideTools, this.debug);
      return { stream, headers: result.headers };
    } catch (error) {
      console.error("Error getting response:", error);
      throw error;
    }
  }

  async response(req: Request, serviceAdapter: CopilotKitServiceAdapter): Promise<Response> {
    const publicApiKey = req.headers.get(COPILOT_CLOUD_PUBLIC_API_KEY_HEADER) || undefined;
    try {
      const response = await this.getResponse(await req.json(), serviceAdapter, publicApiKey);
      return new Response(response.stream, { headers: response.headers });
    } catch (error: any) {
      return new Response(error, { status: error.status });
    }
  }

  async streamHttpServerResponse(
    req: any,
    res: any,
    serviceAdapter: CopilotKitServiceAdapter,
    headers?: Record<string, string>,
  ) {
    const bodyParser = new Promise<any>((resolve, reject) => {
      if ("body" in req) {
        resolve(req.body);
        return;
      }
      let body = "";
      req.on("data", (chunk: any) => (body += chunk.toString()));
      req.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    const forwardedProps = await bodyParser;
    const publicApiKey = req.header(COPILOT_CLOUD_PUBLIC_API_KEY_HEADER) || undefined;
    const response = await this.getResponse(forwardedProps, serviceAdapter, publicApiKey);
    const mergedHeaders = { ...headers, ...response.headers };
    res.writeHead(200, mergedHeaders);
    const stream = response.stream;
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

export function flattenToolCallsNoDuplicates(toolsByPriority: ToolDefinition[]): ToolDefinition[] {
  let allTools: ToolDefinition[] = [];
  const allToolNames: string[] = [];
  for (const tool of toolsByPriority) {
    if (!allToolNames.includes(tool.function.name)) {
      allTools.push(tool);
      allToolNames.push(tool.function.name);
    }
  }
  return allTools;
}
