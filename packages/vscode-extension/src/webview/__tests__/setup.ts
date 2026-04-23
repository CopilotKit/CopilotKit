import { vi } from "vitest";
import type {
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage,
} from "../../extension/types";

const postMessageMock = vi.fn<(msg: WebviewToExtensionMessage) => void>();

(globalThis as any).acquireVsCodeApi = () => ({
  postMessage: postMessageMock,
  getState: () => null,
  setState: vi.fn(),
});

export { postMessageMock };

export function simulateExtensionMessage(
  message: ExtensionToWebviewMessage,
): void {
  window.dispatchEvent(new MessageEvent("message", { data: message }));
}
