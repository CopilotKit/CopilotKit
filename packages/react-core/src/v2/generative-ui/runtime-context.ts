import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { GenerativeUIUserEvent } from "@copilotkit/shared";
import type { GenerativeUIAccessibility } from "./accessibility";
import type { GenerativeUI } from "./catalog";
import type { GenerativeUIDispatcher } from "./dispatcher";
import type { GenerativeUIErrorInfo, GenerativeUIInvokeResult } from "./errors";
import type { GenerativeUISurfaceManager } from "./surface-manager";
import type { GenerativeUITheme } from "./theme";

export type { GenerativeUITheme };

export interface GenerativeUIErrorBoundaryConfig {
  /**
   * Replaces the default fallback of a component that cannot be shown.
   * `kind` says why: "render" when it threw while rendering, in an effect
   * or in a lifecycle method, "props" when its props are invalid once bound
   * and computed values resolve,
   * "unknown-component" when the catalog has no component of its type at
   * render time, "cycle" when it contains itself. An unknown type or an
   * invalid literal prop sent by the agent is normally rejected on arrival,
   * before it gets here; a rejection made in the browser is reported to
   * `onError` as an "operation" error.
   *
   * Only "render" and "props" are also reported to `onError` (whose `kind`
   * is a different list), so a fallback that hides the other two should log
   * them itself. For "render", `retry` renders the component again; for the
   * other kinds it does nothing. A fallback that throws is replaced by the
   * default for that component, and its error is reported to `onError` as
   * "render". A fallback that suspends shows nothing for that component
   * until it resumes (to show a loading state, do the suspending work in a
   * child component and wrap that child in a Suspense of your own); the rest
   * of the surface does not wait for it. A failure of the surface outside
   * its components keeps the default.
   *
   * The fallback is mounted like a component, and runs again whenever the
   * failed component renders. A new function starts with fresh state, so a
   * fallback whose output keeps state (including the components it renders)
   * should be a stable function, defined outside the render or memoized,
   * rather than one written inline.
   */
  fallback?: (props: {
    kind: "render" | "props" | "unknown-component" | "cycle";
    error: Error;
    retry: () => void;
    surfaceId: string;
    componentId: string;
  }) => ReactNode;
  /** Called for render, props, operation, function and event failures. */
  onError?: (info: GenerativeUIErrorInfo) => void;
}

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
   * on under a `.dark` class, like the CopilotKit chat.
   */
  theme?: GenerativeUITheme;
  /** Fallback UI and error reporting for generated UI. */
  errorBoundary?: GenerativeUIErrorBoundaryConfig;
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
 * Experimental. The `generativeUI` prop of `CopilotKitProvider`. Set
 * `transport: "markdown"` to get the markdown options.
 *
 * @example
 * ```tsx
 * <CopilotKitProvider generativeUI={{ ui }} />
 * <CopilotKitProvider generativeUI={{ ui, transport: "markdown", sendContext: false }} />
 * ```
 */
export type GenerativeUIConfig =
  | GenerativeUIToolConfig
  | GenerativeUIMarkdownConfig;

export interface GenerativeUIRuntime {
  manager: GenerativeUISurfaceManager;
  dispatcher: GenerativeUIDispatcher;
  /** The generative UI given to the provider as `generativeUI={{ ui }}`. */
  ui: GenerativeUI;
  /** How the model sends operations. "tool" when the config leaves it out. */
  transport: "tool" | "markdown";
  /** The latest `generativeUI` config of the provider. */
  readonly config: GenerativeUIConfig;
  /** The latest `theme`. Each surface root sets its CSS variables. */
  theme?: GenerativeUITheme;
  forwardEvent: (
    event: GenerativeUIUserEvent,
    agentId: string | undefined,
  ) => Promise<GenerativeUIInvokeResult>;
  reportError: (info: GenerativeUIErrorInfo) => void;
  readonly errorFallback?: GenerativeUIErrorBoundaryConfig["fallback"];
}

export const GenerativeUIRuntimeContext =
  createContext<GenerativeUIRuntime | null>(null);

export function useGenerativeUIRuntime(): GenerativeUIRuntime | null {
  return useContext(GenerativeUIRuntimeContext);
}

export function useRequiredGenerativeUIRuntime(): GenerativeUIRuntime {
  const runtime = useContext(GenerativeUIRuntimeContext);
  if (!runtime) {
    throw new Error(
      "Generative UI components must be rendered inside <CopilotKitProvider generativeUI={{ ui }}>.",
    );
  }
  return runtime;
}

/**
 * Reports an error without ever throwing: `reportError` reaches host code
 * (`onError`), and a throwing host callback must not break rendering or an
 * event handler.
 */
export function reportErrorSafely(
  runtime: GenerativeUIRuntime,
  info: GenerativeUIErrorInfo,
): void {
  try {
    runtime.reportError(info);
  } catch {
    // Intentionally swallowed: there is nowhere safe left to report to.
  }
}

export interface GenerativeUINodeContextValue {
  surfaceKey: string;
  surfaceId: string;
  componentId: string;
  /** The resolved `accessibility` of the component envelope, if any. */
  accessibility?: GenerativeUIAccessibility;
}

export const GenerativeUINodeContext =
  createContext<GenerativeUINodeContextValue | null>(null);
