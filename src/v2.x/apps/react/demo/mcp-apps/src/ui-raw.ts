/**
 * @file App that does NOT depend on Apps SDK runtime.
 *
 * The Raw UI example has no runtime dependency to the Apps SDK
 * but still defines types inline for static type safety.
 *
 * We implement a barebones JSON-RPC message sender/receiver (see `app` object below),
 * but without timeouts or runtime type validation of any kind.
 */

import type {
  CallToolRequest,
  CallToolResult,
  JSONRPCMessage,
  LoggingMessageNotification,
} from "@modelcontextprotocol/sdk/types.js";

// =============================================================================
// Inline Type Definitions (from MCP Apps Extension protocol)
// =============================================================================

interface Implementation {
  name: string;
  version: string;
}

interface McpUiAppCapabilities {
  tools?: { listChanged?: boolean };
  experimental?: Record<string, unknown>;
}

interface McpUiHostCapabilities {
  openLinks?: Record<string, unknown>;
  serverTools?: { listChanged?: boolean };
  serverResources?: { listChanged?: boolean };
  logging?: Record<string, unknown>;
  experimental?: Record<string, unknown>;
}

interface McpUiHostContext {
  toolInfo?: { id: string | number; tool: unknown };
  theme?: "light" | "dark" | "system";
  displayMode?: "inline" | "fullscreen" | "pip";
  availableDisplayModes?: string[];
  viewport?: { width: number; height: number; maxHeight?: number; maxWidth?: number };
  locale?: string;
  timeZone?: string;
  userAgent?: string;
  platform?: "web" | "desktop" | "mobile";
  deviceCapabilities?: { touch?: boolean; hover?: boolean };
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number };
}

type McpUiInitializeRequest = {
  method: "ui/initialize";
  params: {
    protocolVersion: string;
    appInfo: Implementation;
    appCapabilities: McpUiAppCapabilities;
  };
};

type McpUiInitializeResult = {
  protocolVersion: string;
  hostInfo: Implementation;
  hostCapabilities: McpUiHostCapabilities;
  hostContext?: McpUiHostContext;
};

type McpUiInitializedNotification = {
  method: "ui/notifications/initialized";
  params: Record<string, never>;
};

type McpUiToolInputNotification = {
  method: "ui/notifications/tool-input";
  params: {
    arguments?: Record<string, unknown>;
  };
};

type McpUiToolResultNotification = {
  method: "ui/notifications/tool-result";
  params: {
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
};

type McpUiHostContextChangedNotification = {
  method: "ui/notifications/host-context-changed";
  params: Partial<McpUiHostContext>;
};

type McpUiSizeChangeNotification = {
  method: "ui/notifications/size-change";
  params: {
    width: number;
    height: number;
  };
};

type McpUiMessageRequest = {
  method: "ui/message";
  params: {
    role: "user" | "assistant";
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  };
};

type McpUiMessageResult = {
  isError?: boolean;
};

type McpUiOpenLinkRequest = {
  method: "ui/open-link";
  params: {
    url: string;
  };
};

type McpUiOpenLinkResult = {
  isError?: boolean;
};

// =============================================================================
// Barebones JSON-RPC App Implementation
// =============================================================================

const app = (() => {
  type Sendable = { method: string; params: unknown };

  let nextId = 1;

  return {
    sendRequest<T extends Sendable, Result>({ method, params }: T) {
      const id = nextId++;
      window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
      return new Promise<Result>((resolve, reject) => {
        window.addEventListener("message", function listener(event) {
          const data: JSONRPCMessage = event.data;
          if (event.data?.id === id) {
            window.removeEventListener("message", listener);
            if (event.data?.result) {
              resolve(event.data.result as Result);
            } else if (event.data?.error) {
              reject(new Error(event.data.error));
            }
          } else {
            reject(new Error(`Unsupported message: ${JSON.stringify(data)}`));
          }
        });
      });
    },
    sendNotification<T extends Sendable>({ method, params }: T) {
      window.parent.postMessage({ jsonrpc: "2.0", method, params }, "*");
    },
    onNotification<T extends Sendable>(
      method: T["method"],
      handler: (params: T["params"]) => void,
    ) {
      window.addEventListener("message", function listener(event) {
        if (event.data?.method === method) {
          handler(event.data.params);
        }
      });
    },
  };
})();

// =============================================================================
// UI Initialization and Event Handlers
// =============================================================================

window.addEventListener("load", async () => {
  const root = document.getElementById("root")!;
  const appendText = (textContent: string, style?: string) => {
    const div = document.createElement("div");
    div.textContent = textContent;
    if (style) {
      div.setAttribute("style", style);
    }
    root.appendChild(div);
  };
  const appendError = (error: unknown) =>
    appendText(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
      "color: red;",
    );

  // Register notification handlers
  app.onNotification<McpUiToolInputNotification>(
    "ui/notifications/tool-input",
    async (params) => {
      appendText(`Tool call input: ${JSON.stringify(params)}`);
    },
  );
  app.onNotification<McpUiToolResultNotification>(
    "ui/notifications/tool-result",
    async (params) => {
      appendText(`Tool call result: ${JSON.stringify(params)}`);
    },
  );
  app.onNotification<McpUiHostContextChangedNotification>(
    "ui/notifications/host-context-changed",
    async (params) => {
      appendText(`Host context changed: ${JSON.stringify(params)}`);
    },
  );

  // Initialize with host
  const initializeResult = await app.sendRequest<
    McpUiInitializeRequest,
    McpUiInitializeResult
  >({
    method: "ui/initialize",
    params: {
      appCapabilities: {},
      appInfo: { name: "My UI", version: "1.0.0" },
      protocolVersion: "2025-06-18",
    },
  });

  appendText(`Initialize result: ${JSON.stringify(initializeResult)}`);

  // Notify host that we're initialized
  app.sendNotification<McpUiInitializedNotification>({
    method: "ui/notifications/initialized",
    params: {},
  });

  // Set up automatic size reporting
  new ResizeObserver(() => {
    const rect = (
      document.body.parentElement ?? document.body
    ).getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    app.sendNotification<McpUiSizeChangeNotification>({
      method: "ui/notifications/size-change",
      params: { width, height },
    });
  }).observe(document.body);

  // =============================================================================
  // Interactive Buttons
  // =============================================================================

  // Get Weather Tool button
  root.appendChild(
    Object.assign(document.createElement("button"), {
      textContent: "Get Weather (Tool)",
      onclick: async () => {
        try {
          const result = await app.sendRequest<CallToolRequest, CallToolResult>(
            {
              method: "tools/call",
              params: {
                name: "get-weather",
                arguments: { location: "Tokyo" },
              },
            },
          );

          appendText(`Weather tool result: ${JSON.stringify(result)}`);
        } catch (e) {
          appendError(e);
        }
      },
    }),
  );

  // Notify Cart Updated button
  root.appendChild(
    Object.assign(document.createElement("button"), {
      textContent: "Notify Cart Updated",
      onclick: async () => {
        app.sendNotification<LoggingMessageNotification>({
          method: "notifications/message",
          params: {
            level: "info",
            data: "cart-updated",
          },
        });
      },
    }),
  );

  // Prompt Weather button
  root.appendChild(
    Object.assign(document.createElement("button"), {
      textContent: "Prompt Weather in Tokyo",
      onclick: async () => {
        try {
          const { isError } = await app.sendRequest<
            McpUiMessageRequest,
            McpUiMessageResult
          >({
            method: "ui/message",
            params: {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "What is the weather in Tokyo?",
                },
              ],
            },
          });

          appendText(`Message result: ${isError ? "error" : "success"}`);
        } catch (e) {
          appendError(e);
        }
      },
    }),
  );

  // Open Link button
  root.appendChild(
    Object.assign(document.createElement("button"), {
      textContent: "Open Link to Google",
      onclick: async () => {
        try {
          const { isError } = await app.sendRequest<
            McpUiOpenLinkRequest,
            McpUiOpenLinkResult
          >({
            method: "ui/open-link",
            params: {
              url: "https://www.google.com",
            },
          });
          appendText(`Link result: ${isError ? "error" : "success"}`);
        } catch (e) {
          appendError(e);
        }
      },
    }),
  );

  console.log("Initialized with host info:", initializeResult.hostInfo);
});
