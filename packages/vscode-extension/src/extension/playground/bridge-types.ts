import type { PlaygroundScanResult } from "./types";
import type { FixtureListEntry } from "./fixture-store";

export interface BundleReadyPayload {
  /** IIFE JavaScript the webview injects as a nonced <script>. */
  code: string;
  /** Optional collected CSS to inject. */
  css?: string;
}

export interface MountErrorPayload {
  componentName: string;
  filePath: string;
  error: { message: string; stack?: string };
}

/** Messages the extension host sends to the webview. */
export type PlaygroundExtensionToWebviewMessage =
  | { type: "scan-result"; result: PlaygroundScanResult }
  | { type: "bundle-ready"; payload: BundleReadyPayload }
  | { type: "bundle-error"; message: string }
  | {
      type: "mode-unsupported";
      kind: "proxy" | "dynamic-runtime-url";
      detail?: string;
    }
  | {
      type: "models-list";
      models: Array<{
        id: string;
        name: string;
        family: string;
        vendor: string;
      }>;
    }
  | { type: "no-model-available" }
  | { type: "runtime-error"; message: string }
  | { type: "error"; message: string }
  // Plan #4 additions
  | { type: "fixtures-list"; fixtures: FixtureListEntry[] }
  | {
      type: "session-info";
      runtimeUrl: string;
      replayMode: boolean;
      fixtureName: string | null;
    }
  | { type: "fixture-saved"; filePath: string }
  | { type: "diagnostics"; errors: MountErrorPayload[]; tools: unknown[] };

/** Messages the webview sends back to the extension host. */
export type PlaygroundWebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "open-source"; filePath: string; line?: number }
  | { type: "select-model"; id: string }
  // Plan #4 additions
  | { type: "save-fixture"; name: string }
  | { type: "load-fixture"; filePath: string }
  | { type: "new-chat" }
  | { type: "delete-fixture"; filePath: string };
