import type { HookCallSite } from "./hook-scanner";
import type { HookTreeStatus } from "./tree-model";

/**
 * Shared message contract between the Hook List sidebar webview and the
 * extension host. Both sides import these types so the bridge stays
 * type-safe end-to-end.
 */

// Extension → Webview
export type HookListToWebviewMessage =
  | { type: "init"; workspaceRoot: string | null }
  | {
      type: "sites";
      sites: HookCallSite[];
      statuses: Record<string, HookTreeStatus>;
    }
  | { type: "status"; site: HookCallSite; status: HookTreeStatus };

// Webview → Extension
export type HookListFromWebviewMessage =
  | { type: "ready" }
  | { type: "preview"; site: HookCallSite }
  | { type: "openSource"; site: HookCallSite }
  | { type: "copyIdentity"; site: HookCallSite }
  | { type: "refresh" };
