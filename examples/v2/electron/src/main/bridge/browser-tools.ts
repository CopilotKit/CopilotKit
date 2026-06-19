import { defineTool } from "@copilotkit/runtime/v2";
import type { ToolDefinition } from "@copilotkit/runtime/v2";
import { z } from "zod";
import type { BridgeMethod } from "./protocol";

/**
 * Structural interface satisfied by {@link BridgeServer} from `./server`.
 * Declared here to keep this module Electron-free (no `net`, `ws`, etc.).
 */
export interface BridgeRequester {
  request(
    method: BridgeMethod,
    params: Record<string, unknown>,
  ): Promise<unknown>;
  isConnected(): boolean;
}

/**
 * Returns the browser READ tool set backed by the given {@link BridgeRequester}.
 *
 * Currently exposes a single tool: `browser_read_active_tab`.
 * The execute handler NEVER throws — bridge failures degrade to a tagged error
 * result so the agent turn is not aborted.
 */
export function createBrowserReadTools(
  bridge: BridgeRequester,
): ToolDefinition[] {
  const browserReadActiveTabTool = defineTool({
    name: "browser_read_active_tab",
    description:
      "Read the URL, title, selected text, and visible text content of the active browser tab via the companion extension. Returns { connected: false } when no extension is paired.",
    parameters: z.object({}),
    execute: async () => {
      if (!bridge.isConnected()) {
        return {
          connected: false,
          message:
            "No browser connected. Install and pair the companion extension.",
        };
      }
      try {
        const data = await bridge.request("readActiveTab", {});
        return { connected: true, ...(data as Record<string, unknown>) };
      } catch (e) {
        return {
          connected: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
  });

  return [browserReadActiveTabTool];
}
