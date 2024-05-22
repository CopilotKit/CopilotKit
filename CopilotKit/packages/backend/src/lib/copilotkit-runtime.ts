/**
 * Handles requests from frontend, provides function calling and various LLM backends.
 *
 * <img
 *   referrerPolicy="no-referrer-when-downgrade"
 *   src="https://static.scarf.sh/a.png?x-pxid=a9b290bb-38f9-4518-ac3b-8f54fdbf43be"
 * />
 *
 * <RequestExample>
 *   ```jsx CopilotRuntime Example
 *   import {
 *     CopilotRuntime,
 *     OpenAIAdapter
 *   } from "@copilotkit/backend";
 *
 *   export async function POST(req: Request) {
 *     const copilotKit = new CopilotRuntime();
 *     return copilotKit.response(req, new OpenAIAdapter());
 *   }
 *
 * ```
 * </RequestExample>
 *
 * This class is the main entry point for the runtime. It handles requests from the frontend, provides function calling and various LLM backends.
 *
 * For example, to use OpenAI as a backend (check the [OpenAI Adapter](./OpenAIAdapter) docs for more info):
 * ```typescript
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(req, new OpenAIAdapter());
 * ```
 *
 * Currently we support:
 *
 * - [OpenAI](./OpenAIAdapter)
 * - [LangChain](./LangChainAdapter)
 * - [OpenAI Assistant API](./OpenAIAssistantAdapter)
 * - [Google Gemini](./GoogleGenerativeAIAdapter)
 *
 * ## Server Side Actions
 *
 * CopilotKit supports actions that can be executed on the server side. You can define server side actions by passing the `actions` parameter:
 *
 * ```typescript
 * const copilotKit = new CopilotRuntime({
 *   actions: [
 *     {
 *       name: "sayHello",
 *       description: "Says hello to someone.",
 *       argumentAnnotations: [
 *         {
 *           name: "arg",
 *           type: "string",
 *           description: "The name of the person to say hello to.",
 *           required: true,
 *         },
 *       ],
 *       implementation: async (arg) => {
 *         console.log("Hello from the server", arg, "!");
 *       },
 *     },
 *   ],
 * });
 * ```
 *
 * Server side actions can also return a result which becomes part of the message history.
 *
 * This is useful because it gives the LLM context about what happened on the server side. In addition,
 * it can be used to look up information from a vector or relational database and other sources.
 *
 * In addition to that, server side actions can also come from LangChain, including support for streaming responses.
 *
 * Returned results can be of the following type:
 *
 * - anything serializable to JSON
 * - `string`
 * - LangChain types:
 *   - `IterableReadableStream`
 *   - `BaseMessageChunk`
 *   - `AIMessage`
 *
 * ## LangServe
 *
 * The backend also supports LangServe, enabling you to connect to existing chains, for example python based chains.
 * Use the `langserve` parameter to specify URLs for LangServe.
 *
 * ```typescript
 * const copilotKit = new CopilotRuntime({
 *   langserve: [
 *     {
 *       chainUrl: "http://my-langserve.chain",
 *       name: "performResearch",
 *       description: "Performs research on a given topic.",
 *     },
 *   ],
 * });
 * ```
 *
 * When left out, arguments are automatically inferred from the schema provided by LangServe.
 */

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

interface CopilotRuntimeResult {
  stream: ReadableStream;
  headers?: Record<string, string>;
}

interface CopilotRuntimeConstructorParams<T extends Parameter[] | [] = []> {
  /*
   * A list of server side actions that can be executed.
   */
  actions?: Action<T>[];

  /*
   * An array of LangServer URLs.
   */
  langserve?: RemoteChain[];

  debug?: boolean;
  copilotCloud?: CopilotCloud;
}

interface CopilotDeprecatedRuntimeConstructorParams<T extends Parameter[] | [] = []> {
  actions?: AnnotatedFunction<any>[];
  langserve?: RemoteChain[];
  debug?: boolean;
  copilotCloud?: CopilotCloud;
}

export class CopilotRuntime<const T extends Parameter[] | [] = []> {
  private actions: Action<any>[] = [];
  private langserve: Promise<Action<any>>[] = [];
  private debug: boolean = false;
  private copilotCloud: CopilotCloud;

  constructor(params?: CopilotRuntimeConstructorParams<T>);
  // @deprecated use Action<T> instead of AnnotatedFunction<T>
  constructor(params?: CopilotDeprecatedRuntimeConstructorParams<T>);
  constructor(
    params?: CopilotRuntimeConstructorParams<T> | CopilotDeprecatedRuntimeConstructorParams<T>,
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
  ): Promise<CopilotRuntimeResult> {
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
      ...(forwardedProps.tools || []),
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

  /**
   * Returns a `Response` object for streaming back the result to the client
   *
   * @param req The HTTP request
   * @param serviceAdapter The adapter to use for the response.
   */
  async response(req: Request, serviceAdapter: CopilotKitServiceAdapter): Promise<Response> {
    const publicApiKey = req.headers.get(COPILOT_CLOUD_PUBLIC_API_KEY_HEADER) || undefined;
    try {
      const forwardedProps = await req.json();
      const response = await this.getResponse(forwardedProps, serviceAdapter, publicApiKey);
      return new Response(response.stream, { headers: response.headers });
    } catch (error: any) {
      return new Response(error, { status: error.status });
    }
  }

  /**
   * Streams messages back to the client using the HTTP response object. Use with express,
or Node.js HTTP server.
    *
    * @param req The HTTP request
    * @param res The HTTP response
    * @param serviceAdapter The adapter to use for the response.
    * @param headers Additional headers to send with the response.
    */
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
    const publicApiKey =
      (req.header
        ? // use header() in express
          req.header(COPILOT_CLOUD_PUBLIC_API_KEY_HEADER)
        : // use headers in node http
          req.headers[COPILOT_CLOUD_PUBLIC_API_KEY_HEADER.toLowerCase()]) || undefined;
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

/**
 * @deprecated use CopilotRuntime instead
 */
export class CopilotBackend extends CopilotRuntime {}
