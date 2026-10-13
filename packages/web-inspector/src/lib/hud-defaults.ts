import type { HudContent } from "./hud-config.js";

/** Built-in HUD copy and destinations; a matching feed rule overrides fields. */
export const HUD_DEFAULT_CONTENT: HudContent = {
  threads: {
    label: "Rich Threads",
    description: "Click to learn more",
    destination: "threads",
  },
  learning: {
    label: "Automatic Learning",
    description: "Click to learn more",
    destination: "memories",
  },
};
