import type { PlaygroundScanResult } from "./types";

export interface BundleReadyPayload {
  /** IIFE JavaScript the webview injects as a nonced <script>. */
  code: string;
  /** Optional collected CSS to inject. */
  css?: string;
}

/** Messages the extension host sends to the webview. */
export type PlaygroundExtensionToWebviewMessage =
  | { type: "scan-result"; result: PlaygroundScanResult }
  | { type: "bundle-ready"; payload: BundleReadyPayload }
  | { type: "bundle-error"; message: string }
  | { type: "error"; message: string };

/** Messages the webview sends back to the extension host. */
export type PlaygroundWebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "open-source"; filePath: string; line?: number };
