import type { SandboxFunction } from "@copilotkit/angular";
import { z } from "zod";

export type Theme = "light" | "dark";

type ThemeHandler = (mode: Theme) => void;

let currentThemeHandler: ThemeHandler | undefined;

const setThemeParameters = z.object({
  mode: z.enum(["light", "dark"]).describe("The theme mode to set"),
});

export function bindA2UIDemoThemeHandler(handler: ThemeHandler): () => void {
  currentThemeHandler = handler;
  return () => {
    if (currentThemeHandler === handler) {
      currentThemeHandler = undefined;
    }
  };
}

export const a2uiDemoSandboxFunctions: SandboxFunction[] = [
  {
    name: "setTheme",
    description:
      "Switch the host application theme between light and dark mode. " +
      "Call this when the user asks to change the theme or when generating UI with a theme toggle.",
    parameters: setThemeParameters,
    handler: async (args) => {
      const { mode } = setThemeParameters.parse(args);
      currentThemeHandler?.(mode);
      return `Theme set to ${mode}`;
    },
  },
];
