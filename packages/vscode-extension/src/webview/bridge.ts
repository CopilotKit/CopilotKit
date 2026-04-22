import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from "../extension/types";

type MessageHandler<T extends ExtensionToWebviewMessage["type"]> = (
  payload: Extract<ExtensionToWebviewMessage, { type: T }>,
) => void;

// Acquire the VS Code API (only available inside webview context)
declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToExtensionMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const listeners = new Map<string, Set<MessageHandler<any>>>();

// Listen for messages from extension host
window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as ExtensionToWebviewMessage;
  const handlers = listeners.get(message.type);
  if (handlers) {
    for (const handler of handlers) {
      handler(message);
    }
  }
});

export const bridge = {
  on<T extends ExtensionToWebviewMessage["type"]>(
    type: T,
    handler: MessageHandler<T>,
  ): () => void {
    if (!listeners.has(type)) {
      listeners.set(type, new Set());
    }
    listeners.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      listeners.get(type)?.delete(handler);
    };
  },

  send(message: WebviewToExtensionMessage): void {
    vscode.postMessage(message);
  },
};
