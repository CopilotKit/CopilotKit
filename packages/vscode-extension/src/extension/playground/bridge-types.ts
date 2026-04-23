import type { PlaygroundScanResult } from "./types";

/** Messages the extension host sends to the webview. */
export type PlaygroundExtensionToWebviewMessage =
  | { type: "scan-result"; result: PlaygroundScanResult }
  | { type: "error"; message: string };

/** Messages the webview sends back to the extension host. */
export type PlaygroundWebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "open-source"; filePath: string; line?: number };
