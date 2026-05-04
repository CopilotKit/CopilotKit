import type { PlaygroundScanResult } from "./types";
import type { FixtureListEntry } from "./fixture-store";
import type { ReplayMessage } from "./fixture-replay";

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
      /**
       * Snapshot of whether vscode.lm tools were exposed for the model
       * on this session, plus how many were registered system-wide. The
       * Diagnostics panel renders this so the user can tell at a glance
       * whether Copilot Chat (or another LM-tool provider) is installed.
       */
      vscodeLmTools: { enabled: boolean; count: number };
      /**
       * Diagnostic info about the Tailwind compile pass that ran during
       * bundling. `entryCss` is set when a CSS entry was found and CSS was
       * generated; `skipped` carries a human-readable reason when no
       * Tailwind setup was detected; `error` carries the failure message
       * when compilation was attempted but threw.
       */
      tailwind?: {
        entryCss?: string;
        skipped?: string;
        error?: string;
      };
    }
  | { type: "fixture-saved"; filePath: string }
  /**
   * Sent right after the chat tab has finished bundling in response to
   * a `load-fixture` request. The webview animates these messages into
   * the chat surface one at a time so the user can watch the saved
   * conversation play back.
   */
  | { type: "play-fixture"; messages: ReplayMessage[] }
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
  | { type: "delete-fixture"; filePath: string }
  /**
   * The user clicked a tool name pill in the chat surface; we resolve it
   * against the latest scan result and reveal the source line that
   * registered the hook in the editor.
   */
  | { type: "open-tool-source"; name: string };
