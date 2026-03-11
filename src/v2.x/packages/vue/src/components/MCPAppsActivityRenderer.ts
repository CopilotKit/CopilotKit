import {
  computed,
  defineComponent,
  h,
  ref,
  watch,
  type PropType,
} from "vue";
import { z } from "zod";
import type { AbstractAgent, RunAgentResult } from "@ag-ui/client";
import { randomUUID } from "@copilotkitnext/shared";
import type { VueActivityMessageRendererProps } from "../types";

const PROTOCOL_VERSION = "2025-06-18";

function buildSandboxHTML(extraCspDomains?: string[]): string {
  const baseScriptSrc =
    "'self' 'wasm-unsafe-eval' 'unsafe-inline' 'unsafe-eval' blob: data: http://localhost:* https://localhost:*";
  const baseFrameSrc = "* blob: data: http://localhost:* https://localhost:*";
  const extra = extraCspDomains?.length ? ` ${extraCspDomains.join(" ")}` : "";
  const scriptSrc = `${baseScriptSrc}${extra}`;
  const frameSrc = `${baseFrameSrc}${extra}`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src * data: blob: 'unsafe-inline'; media-src * blob: data:; font-src * blob: data:; script-src ${scriptSrc}; style-src * blob: data: 'unsafe-inline'; connect-src *; frame-src ${frameSrc}; base-uri 'self';" />
<style>html,body{margin:0;padding:0;height:100%;width:100%;overflow:hidden}*{box-sizing:border-box}iframe{background-color:transparent;border:none;padding:0;overflow:hidden;width:100%;height:100%}</style>
</head>
<body>
<script>
if(window.self===window.top){throw new Error("This file must be used in an iframe.")}
const inner=document.createElement("iframe");
inner.style="width:100%;height:100%;border:none;";
inner.setAttribute("sandbox","allow-scripts allow-same-origin allow-forms");
document.body.appendChild(inner);
window.addEventListener("message",async(event)=>{
if(event.source===window.parent){
if(event.data&&event.data.method==="ui/notifications/sandbox-resource-ready"){
const{html,sandbox}=event.data.params;
if(typeof sandbox==="string")inner.setAttribute("sandbox",sandbox);
if(typeof html==="string")inner.srcdoc=html;
}else if(inner&&inner.contentWindow){
inner.contentWindow.postMessage(event.data,"*");
}
}else if(event.source===inner.contentWindow){
window.parent.postMessage(event.data,"*");
}
});
window.parent.postMessage({jsonrpc:"2.0",method:"ui/notifications/sandbox-proxy-ready",params:{}},"*");
</script>
</body>
</html>`;
}

class MCPAppsRequestQueue {
  private queues = new Map<
    string,
    Array<{
      execute: () => Promise<RunAgentResult>;
      resolve: (result: RunAgentResult) => void;
      reject: (error: Error) => void;
    }>
  >();

  private processing = new Map<string, boolean>();

  async enqueue(
    agent: AbstractAgent,
    request: () => Promise<RunAgentResult>,
  ): Promise<RunAgentResult> {
    const threadId = agent.threadId || "default";

    return new Promise((resolve, reject) => {
      let queue = this.queues.get(threadId);
      if (!queue) {
        queue = [];
        this.queues.set(threadId, queue);
      }

      queue.push({ execute: request, resolve, reject });
      void this.processQueue(threadId, agent);
    });
  }

  private async processQueue(
    threadId: string,
    agent: AbstractAgent,
  ): Promise<void> {
    if (this.processing.get(threadId)) {
      return;
    }

    this.processing.set(threadId, true);
    try {
      const queue = this.queues.get(threadId);
      if (!queue) return;

      while (queue.length > 0) {
        const item = queue[0]!;
        try {
          await this.waitForAgentIdle(agent);
          const result = await item.execute();
          item.resolve(result);
        } catch (error) {
          item.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
        queue.shift();
      }
    } finally {
      this.processing.set(threadId, false);
    }
  }

  private waitForAgentIdle(agent: AbstractAgent): Promise<void> {
    return new Promise((resolve) => {
      if (!agent.isRunning) {
        resolve();
        return;
      }

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearInterval(checkInterval);
        sub.unsubscribe();
        resolve();
      };

      const sub = agent.subscribe({
        onRunFinalized: finish,
        onRunFailed: finish,
      });

      const checkInterval = setInterval(() => {
        if (!agent.isRunning) {
          finish();
        }
      }, 500);
    });
  }
}

const mcpAppsRequestQueue = new MCPAppsRequestQueue();

export const MCPAppsActivityType = "mcp-apps";

export const MCPAppsActivityContentSchema = z.object({
  result: z.object({
    content: z.array(z.any()).optional(),
    structuredContent: z.any().optional(),
    isError: z.boolean().optional(),
  }),
  resourceUri: z.string(),
  serverHash: z.string(),
  serverId: z.string().optional(),
  toolInput: z.record(z.unknown()).optional(),
});

export type MCPAppsActivityContent = z.infer<typeof MCPAppsActivityContentSchema>;

interface FetchedResource {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: {
    ui?: {
      prefersBorder?: boolean;
      csp?: {
        connectDomains?: string[];
        resourceDomains?: string[];
      };
    };
  };
}

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

function isRequest(message: JSONRPCMessage): message is JSONRPCRequest {
  return "id" in message && "method" in message;
}

function isNotification(message: JSONRPCMessage): message is JSONRPCNotification {
  return !("id" in message) && "method" in message;
}

export const MCPAppsActivityRenderer = defineComponent({
  name: "MCPAppsActivityRenderer",
  props: {
    activityType: {
      type: String,
      required: true,
    },
    content: {
      type: Object as PropType<MCPAppsActivityContent>,
      required: true,
    },
    message: {
      type: Object as PropType<VueActivityMessageRendererProps<MCPAppsActivityContent>["message"]>,
      required: true,
    },
    agent: {
      type: Object as PropType<AbstractAgent | undefined>,
      required: false,
      default: undefined,
    },
  },
  setup(props) {
    const containerRef = ref<HTMLDivElement | null>(null);
    const iframeRef = ref<HTMLIFrameElement | null>(null);
    const iframeReady = ref(false);
    const error = ref<Error | null>(null);
    const isLoading = ref(true);
    const iframeSize = ref<{ width?: number; height?: number }>({});
    const fetchedResource = ref<FetchedResource | null>(null);

    const fetchStateRef = ref<{
      inProgress: boolean;
      promise: Promise<FetchedResource | null> | null;
      resourceUri: string | null;
    }>({
      inProgress: false,
      promise: null,
      resourceUri: null,
    });

    const sendToIframe = (message: JSONRPCMessage) => {
      if (iframeRef.value?.contentWindow) {
        iframeRef.value.contentWindow.postMessage(message, "*");
      }
    };

    const sendResponse = (id: string | number, result: unknown) => {
      sendToIframe({
        jsonrpc: "2.0",
        id,
        result,
      });
    };

    const sendErrorResponse = (
      id: string | number,
      code: number,
      message: string,
    ) => {
      sendToIframe({
        jsonrpc: "2.0",
        id,
        error: { code, message },
      });
    };

    const sendNotification = (method: string, params?: Record<string, unknown>) => {
      sendToIframe({
        jsonrpc: "2.0",
        method,
        params: params || {},
      });
    };

    watch(
      [() => props.agent, () => props.content],
      ([agent, content]) => {
        isLoading.value = true;
        error.value = null;
        iframeReady.value = false;
        iframeSize.value = {};
        fetchedResource.value = null;

        const { resourceUri, serverHash, serverId } = content;

        if (
          fetchStateRef.value.inProgress &&
          fetchStateRef.value.resourceUri === resourceUri
        ) {
          void fetchStateRef.value.promise
            ?.then((resource) => {
              if (resource) {
                fetchedResource.value = resource;
                isLoading.value = false;
              }
            })
            .catch((err: unknown) => {
              error.value = err instanceof Error ? err : new Error(String(err));
              isLoading.value = false;
            });
          return;
        }

        if (!agent) {
          error.value = new Error("No agent available to fetch resource");
          isLoading.value = false;
          return;
        }

        fetchStateRef.value.inProgress = true;
        fetchStateRef.value.resourceUri = resourceUri;

        const fetchPromise = (async (): Promise<FetchedResource | null> => {
          try {
            const runResult = await mcpAppsRequestQueue.enqueue(agent, () =>
              agent.runAgent({
                forwardedProps: {
                  __proxiedMCPRequest: {
                    serverHash,
                    serverId,
                    method: "resources/read",
                    params: { uri: resourceUri },
                  },
                },
              }),
            );

            const resultData = runResult.result as
              | { contents?: FetchedResource[] }
              | undefined;
            const resource = resultData?.contents?.[0];

            if (!resource) {
              throw new Error("No resource content in response");
            }

            return resource;
          } finally {
            fetchStateRef.value.inProgress = false;
          }
        })();

        fetchStateRef.value.promise = fetchPromise;

        void fetchPromise
          .then((resource) => {
            if (resource) {
              fetchedResource.value = resource;
              isLoading.value = false;
            }
          })
          .catch((err: unknown) => {
            error.value = err instanceof Error ? err : new Error(String(err));
            isLoading.value = false;
          });
      },
      { immediate: true },
    );

    watch(
      [isLoading, fetchedResource],
      ([loading, resource], _old, onCleanup) => {
        if (loading || !resource) {
          return;
        }

        const container = containerRef.value;
        if (!container) {
          return;
        }

        let mounted = true;
        let messageHandler: ((event: MessageEvent) => void) | null = null;
        let initialListener: ((event: MessageEvent) => void) | null = null;
        let createdIframe: HTMLIFrameElement | null = null;

        const setup = async () => {
          try {
            const iframe = document.createElement("iframe");
            createdIframe = iframe;
            iframe.style.width = "100%";
            iframe.style.height = "100px";
            iframe.style.border = "none";
            iframe.style.backgroundColor = "transparent";
            iframe.style.display = "block";
            iframe.setAttribute(
              "sandbox",
              "allow-scripts allow-same-origin allow-forms",
            );

            const sandboxReady = new Promise<void>((resolve) => {
              initialListener = (event: MessageEvent) => {
                if (
                  event.source === iframe.contentWindow &&
                  event.data?.method === "ui/notifications/sandbox-proxy-ready"
                ) {
                  if (initialListener) {
                    window.removeEventListener("message", initialListener);
                    initialListener = null;
                  }
                  resolve();
                }
              };
              window.addEventListener("message", initialListener);
            });

            if (!mounted) {
              if (initialListener) {
                window.removeEventListener("message", initialListener);
                initialListener = null;
              }
              return;
            }

            const cspDomains =
              fetchedResource.value?._meta?.ui?.csp?.resourceDomains;
            iframe.srcdoc = buildSandboxHTML(cspDomains);
            iframeRef.value = iframe;
            container.appendChild(iframe);

            await sandboxReady;
            if (!mounted) return;

            messageHandler = async (event: MessageEvent) => {
              if (event.source !== iframe.contentWindow) return;

              const msg = event.data as JSONRPCMessage;
              if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
                return;
              }

              if (isRequest(msg)) {
                switch (msg.method) {
                  case "ui/initialize": {
                    sendResponse(msg.id, {
                      protocolVersion: PROTOCOL_VERSION,
                      hostInfo: {
                        name: "CopilotKit MCP Apps Host",
                        version: "1.0.0",
                      },
                      hostCapabilities: {
                        openLinks: {},
                        logging: {},
                      },
                      hostContext: {
                        theme: "light",
                        platform: "web",
                      },
                    });
                    break;
                  }

                  case "ui/message": {
                    const currentAgent = props.agent;
                    if (!currentAgent) {
                      sendResponse(msg.id, { isError: false });
                      break;
                    }

                    try {
                      const params = msg.params as
                        | {
                            role?: string;
                            content?: Array<{ type: string; text?: string }>;
                          }
                        | undefined;

                      const textContent =
                        params?.content
                          ?.filter((part) => part.type === "text" && part.text)
                          .map((part) => part.text)
                          .join("\n") || "";

                      if (textContent) {
                        currentAgent.addMessage({
                          id: randomUUID(),
                          role: (params?.role as "user" | "assistant") || "user",
                          content: textContent,
                        });
                      }

                      sendResponse(msg.id, { isError: false });
                    } catch {
                      sendResponse(msg.id, { isError: true });
                    }
                    break;
                  }

                  case "ui/open-link": {
                    const url = msg.params?.url as string | undefined;
                    if (!url) {
                      sendErrorResponse(msg.id, -32602, "Missing url parameter");
                      break;
                    }
                    window.open(url, "_blank", "noopener,noreferrer");
                    sendResponse(msg.id, { isError: false });
                    break;
                  }

                  case "tools/call": {
                    const { serverHash, serverId } = props.content;
                    const currentAgent = props.agent;

                    if (!serverHash) {
                      sendErrorResponse(
                        msg.id,
                        -32603,
                        "No server hash available for proxying",
                      );
                      break;
                    }
                    if (!currentAgent) {
                      sendErrorResponse(
                        msg.id,
                        -32603,
                        "No agent available for proxying",
                      );
                      break;
                    }

                    try {
                      const runResult = await mcpAppsRequestQueue.enqueue(
                        currentAgent,
                        () =>
                          currentAgent.runAgent({
                            forwardedProps: {
                              __proxiedMCPRequest: {
                                serverHash,
                                serverId,
                                method: "tools/call",
                                params: msg.params,
                              },
                            },
                          }),
                      );
                      sendResponse(msg.id, runResult.result || {});
                    } catch (err) {
                      sendErrorResponse(msg.id, -32603, String(err));
                    }
                    break;
                  }

                  default: {
                    sendErrorResponse(
                      msg.id,
                      -32601,
                      `Method not found: ${msg.method}`,
                    );
                  }
                }
              }

              if (isNotification(msg)) {
                switch (msg.method) {
                  case "ui/notifications/initialized":
                    if (mounted) {
                      iframeReady.value = true;
                    }
                    break;

                  case "ui/notifications/size-changed": {
                    const { width, height } = msg.params || {};
                    if (mounted) {
                      iframeSize.value = {
                        width: typeof width === "number" ? width : undefined,
                        height: typeof height === "number" ? height : undefined,
                      };
                    }
                    break;
                  }
                }
              }
            };

            window.addEventListener("message", messageHandler);

            const html = resource.text
              ? resource.text
              : resource.blob
                ? atob(resource.blob)
                : null;

            if (!html) {
              throw new Error("Resource has no text or blob content");
            }

            sendNotification("ui/notifications/sandbox-resource-ready", {
              html,
            });
          } catch (err) {
            if (mounted) {
              error.value = err instanceof Error ? err : new Error(String(err));
            }
          }
        };

        void setup();

        onCleanup(() => {
          mounted = false;
          if (initialListener) {
            window.removeEventListener("message", initialListener);
            initialListener = null;
          }
          if (messageHandler) {
            window.removeEventListener("message", messageHandler);
          }
          if (createdIframe) {
            createdIframe.remove();
            createdIframe = null;
          }
          iframeRef.value = null;
        });
      },
      { flush: "post" },
    );

    watch(
      iframeSize,
      (size) => {
        if (!iframeRef.value) return;
        if (size.width !== undefined) {
          iframeRef.value.style.minWidth = `min(${size.width}px, 100%)`;
          iframeRef.value.style.width = "100%";
        }
        if (size.height !== undefined) {
          iframeRef.value.style.height = `${size.height}px`;
        }
      },
      { deep: true },
    );

    watch(
      [iframeReady, () => props.content.toolInput],
      ([ready, toolInput]) => {
        if (ready && toolInput) {
          sendNotification("ui/notifications/tool-input", {
            arguments: toolInput,
          });
        }
      },
      { deep: true },
    );

    watch(
      [iframeReady, () => props.content.result],
      ([ready, result]) => {
        if (ready && result) {
          sendNotification(
            "ui/notifications/tool-result",
            result as Record<string, unknown>,
          );
        }
      },
      { deep: true },
    );

    const borderStyle = computed(() => {
      const prefersBorder = fetchedResource.value?._meta?.ui?.prefersBorder;
      if (prefersBorder !== true) return {};
      return {
        borderRadius: "8px",
        backgroundColor: "#f9f9f9",
        border: "1px solid #e0e0e0",
      };
    });

    return () =>
      h(
        "div",
        {
          ref: containerRef,
          style: {
            width: "100%",
            height:
              iframeSize.value.height !== undefined
                ? `${iframeSize.value.height}px`
                : "auto",
            minHeight: "100px",
            overflow: "hidden",
            position: "relative",
            ...borderStyle.value,
          },
        },
        [
          isLoading.value
            ? h("div", { style: { padding: "1rem", color: "#666" } }, "Loading...")
            : null,
          error.value
            ? h(
                "div",
                { style: { color: "red", padding: "1rem" } },
                `Error: ${error.value.message}`,
              )
            : null,
        ],
      );
  },
});

export default MCPAppsActivityRenderer;
