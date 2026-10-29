import { InjectionToken } from "@angular/core";
import type { Signal, Type } from "@angular/core";
import type { GenerativeUIEngine } from "@copilotkit/core/generative-ui";
import type { GenerativeUITheme } from "@copilotkit/shared/generative-ui";
import type { GenerativeUI } from "./catalog";

/**
 * What the rendering layer needs from the root service: the engine, plus
 * the theme and a signal that changes with the surfaces. `CopilotGenerativeUI`
 * implements it; a test can provide a stub in its place.
 */
export interface GenerativeUIRuntime extends GenerativeUIEngine {
  /** The generative UI of `provideGenerativeUI({ ui })`. */
  ui: GenerativeUI;
  /** How the model sends operations. "tool" when the config leaves it out. */
  transport: "tool" | "markdown";
  /** The theme. Each surface root sets its CSS variables from it. */
  theme: Signal<GenerativeUITheme | undefined>;
  /** Changes on every surface-manager notification. Read it to follow the surfaces. */
  version: Signal<number>;
  /**
   * Replaces the per-component fallback. Inputs: `message`, `componentId`,
   * and `retry` (if declared) after a render error.
   */
  readonly errorFallback?: Type<unknown>;
}

/**
 * The runtime that the surfaces render with. `provideGenerativeUI` points it
 * at `CopilotGenerativeUI`. The rendering code injects the token, not the
 * service, so a test can render a surface with a stub runtime.
 */
export const GENERATIVE_UI_RUNTIME = new InjectionToken<GenerativeUIRuntime>(
  "GENERATIVE_UI_RUNTIME",
);
