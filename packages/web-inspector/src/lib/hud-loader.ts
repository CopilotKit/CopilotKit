import { parseHudFeed } from "./hud-config.js";
import type { HudFeed } from "./hud-config.js";

export const HUD_FEED_URL = "https://cdn.copilotkit.ai/inspector-hud/v1.json";
let request: Promise<HudFeed | null> | null = null;

/** Load the HUD feed once per page. The request carries no client data. */
export function loadHudFeed(): Promise<HudFeed | null> {
  if (typeof window === "undefined" || typeof fetch === "undefined")
    return Promise.resolve(null);
  // Start inside a promise so even a synchronous fetch failure resolves null.
  request ??= Promise.resolve()
    .then(() => fetch(HUD_FEED_URL, { cache: "no-cache", credentials: "omit" }))
    .then(async (response) => {
      if (!response.ok)
        throw new Error(`Feed request failed (${response.status})`);
      const feed = parseHudFeed(await response.json());
      if (!feed) throw new Error("Feed failed validation");
      return feed;
    })
    .catch((error: unknown) => {
      // The HUD keeps its built-in copy; the warning makes that debuggable.
      console.warn("[CopilotKit Inspector] Failed to load HUD content", error);
      return null;
    });
  return request;
}
