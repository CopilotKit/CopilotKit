import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { GenerativeUIUserEvent } from "@copilotkit/shared";
import type { GenerativeUIAccessibility } from "./accessibility";
import type { GenerativeUI } from "./catalog";
import type { GenerativeUIDispatcher } from "./dispatcher";
import type {
  GenerativeUIErrorInfo,
  GenerativeUIInvokeResult,
} from "@copilotkit/shared/generative-ui";
import type { GenerativeUISurfaceManager } from "./surface-manager";
import type { GenerativeUITheme } from "./theme";

export type { GenerativeUITheme };

export interface GenerativeUIErrorBoundaryConfig {
  /** Replaces the default per-component fallback. */
  fallback?: (props: {
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
