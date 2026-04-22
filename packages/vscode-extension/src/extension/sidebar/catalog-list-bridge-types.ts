import type { DiscoveredComponent } from "../types";

/**
 * Wire protocol between the Catalog sidebar webview and the extension host.
 * Shape mirrors `hook-list-bridge-types.ts` so the UX is consistent: the
 * webview posts `ready` once its listener is attached, and the host replies
 * with `init` (workspace root) + `components` (the list).
 */
export type CatalogListToWebviewMessage =
  | { type: "init"; workspaceRoot: string | null }
  | { type: "components"; components: DiscoveredComponent[] };

export type CatalogListFromWebviewMessage =
  | { type: "ready" }
  | { type: "preview"; component: DiscoveredComponent; fixtureName?: string }
  | {
      type: "openSource";
      component: DiscoveredComponent;
      /** When set, open the fixture file and reveal the named fixture. */
      fixtureName?: string;
    }
  | { type: "refresh" };
