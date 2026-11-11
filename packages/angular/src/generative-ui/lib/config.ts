import { InjectionToken } from "@angular/core";
import type { Signal, Type } from "@angular/core";
import type {
  GenerativeUIErrorInfo,
  GenerativeUITheme,
} from "@copilotkit/shared/generative-ui";
import type { GenerativeUI } from "./catalog";

interface GenerativeUIBaseConfig {
  /**
   * The result of `createGenerativeUI`: the components the model can render,
   * the app state they read and the functions they call.
   */
  ui: GenerativeUI;
  /**
   * The agents that get the generative UI. When omitted, every agent gets
   * it. Other agents get no envelope.
   */
  agentIds?: string[];
  /**
   * Values for the `--a2ui-*` CSS variables and the map style. Top-level
   * values apply in both modes. `dark` changes them in dark mode, which is
   * on under a `.dark` class, like the CopilotKit chat. A signal makes the
   * theme reactive.
   */
  theme?: GenerativeUITheme | Signal<GenerativeUITheme | undefined>;
  /** Called for render, props, operation, function and event failures. */
  onError?: (info: GenerativeUIErrorInfo) => void;
  /**
   * Replaces the per-component fallback. The component gets the inputs
   * `message` (what went wrong) and `componentId`. After a render error it
   * also gets `retry`, if it declares that input: a function that renders
   * the component again.
   */
  errorFallback?: Type<unknown>;
  /**
   * Replaces the card around a surface in the chat. The component gets the
   * inputs `surface`, `surfaceId`, `isStreaming`, `error` and `rejected`,
   * and renders the surface with `<copilot-generative-ui-surface-view>`.
   */
  chatCard?: Type<unknown>;
}

/**
 * The tool transport: the model calls the `render_ui` tool, and the runtime
 * validates each operation before it streams it to the client.
 */
export interface GenerativeUIToolConfig extends GenerativeUIBaseConfig {
  /** Leave it out, or set "tool". */
  transport?: "tool";
  // Markdown-only options. `never` makes them a type error here, also when
  // `transport` is left out.
  sendContext?: never;
  includeCatalog?: never;
}

/**
 * The markdown transport: the model writes the operations in ```a2ui fences
 * in its reply. The client reads and validates them.
 */
export interface GenerativeUIMarkdownConfig extends GenerativeUIBaseConfig {
  transport: "markdown";
  /**
   * Send the component schema and the fence guideline as context entries.
   * Set `false` when the backend builds its own prompt from the envelope.
   * Default `true`.
   */
  sendContext?: boolean;
  /**
   * Send the component schemas in the envelope (`catalog.components`).
   * Default `true`.
   */
  includeCatalog?: boolean;
}

/**
 * Experimental. The config of `provideGenerativeUI`. Set
 * `transport: "markdown"` to get the markdown options.
 *
 * @example
 * ```ts
 * provideGenerativeUI({ ui })
 * provideGenerativeUI({ ui, transport: "markdown", sendContext: false })
 * ```
 */
export type GenerativeUIConfig =
  | GenerativeUIToolConfig
  | GenerativeUIMarkdownConfig;

/** The config given to `provideGenerativeUI`. */
export const GENERATIVE_UI_CONFIG = new InjectionToken<GenerativeUIConfig>(
  "GENERATIVE_UI_CONFIG",
);
