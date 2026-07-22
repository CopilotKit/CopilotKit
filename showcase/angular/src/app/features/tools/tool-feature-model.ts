import type { WritableSignal } from "@angular/core";
import type { FrontendToolConfig } from "@copilotkit/angular";
import { z } from "zod";

type BackgroundToolArgs = {
  background?: string;
  color?: string;
};

/** Create the frontend tool that applies a requested CSS gradient. */
export function createBackgroundTool(
  background: WritableSignal<string>,
): FrontendToolConfig<BackgroundToolArgs> {
  return {
    name: "change_background",
    description: "Change the application background to a CSS gradient.",
    parameters: z.object({
      background: z.string().optional(),
      color: z.string().optional(),
    }),
    handler: async (args) => {
      const next = resolveGradient(args.background ?? args.color);
      background.set(next);
      return { background: next };
    },
  };
}

function resolveGradient(candidate: unknown): string {
  if (typeof candidate === "string" && candidate.includes("gradient")) {
    return candidate;
  }
  const value = typeof candidate === "string" ? candidate.toLowerCase() : "";
  if (value.includes("forest") || value.includes("green")) {
    return "linear-gradient(135deg, #0a3d2e, #059669)";
  }
  if (
    value.includes("cosmic") ||
    value.includes("magenta") ||
    value.includes("navy")
  ) {
    return "linear-gradient(135deg, #1e3a8a, #9333ea)";
  }
  return "linear-gradient(135deg, #ff7e5f, #feb47b 50%, #ff6b6b)";
}
