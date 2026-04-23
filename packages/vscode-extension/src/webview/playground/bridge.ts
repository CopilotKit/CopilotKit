import type {
  PlaygroundExtensionToWebviewMessage,
  PlaygroundWebviewToExtensionMessage,
} from "../../extension/playground/bridge-types";

declare const acquireVsCodeApi: () =>
  | { postMessage: (msg: PlaygroundWebviewToExtensionMessage) => void }
  | undefined;

const vscode =
  typeof acquireVsCodeApi !== "undefined" ? acquireVsCodeApi() : undefined;

export function sendToExtension(
  msg: PlaygroundWebviewToExtensionMessage,
): void {
  vscode?.postMessage(msg);
}

export function onExtensionMessage(
  handler: (msg: PlaygroundExtensionToWebviewMessage) => void,
): () => void {
  const listener = (e: MessageEvent<PlaygroundExtensionToWebviewMessage>) => {
    handler(e.data);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
