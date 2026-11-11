import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { GenerativeUIUserEvent } from "@copilotkit/shared";
import type { GenerativeUIAccessibility } from "./accessibility";
import type { GenerativeUI } from "./catalog";
import type { GenerativeUIDispatcher } from "@copilotkit/core/generative-ui";
import type {
  GenerativeUIErrorInfo,
  GenerativeUIInvokeResult,
} from "@copilotkit/shared/generative-ui";
import type { GenerativeUISurfaceManager } from "@copilotkit/core/generative-ui";
import type { GenerativeUITheme } from "@copilotkit/shared/generative-ui";

export type { GenerativeUITheme };

export interface GenerativeUIErrorBoundaryConfig {
  /**
   * Replaces the host's fallback for a component that failed to render. It
   * is not used for invalid props, unknown types, cyclic references or a
   * failed surface: the host's `NodeFallback` shows those. If it throws,
   * the host's fallback stands in and the error is reported. `error` is
   * always an Error: a component that throws something else (a string,
   * `undefined`) gets an Error that describes it, with the value as its
   * `cause`.
   */
  fallback?: (props: {
    error: Error;
    retry: () => void;
    surfaceId: string;
    componentId: string;
  }) => ReactNode;
  /**
   * Called for render, props, operation, function and event failures. A
   * render or props failure that stays the same across new revisions of the
   * node or the surface is reported once, until the node or surface renders
   * again. A failed function or event is reported on every call.
   */
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
   * Web only. Values for the `--a2ui-*` CSS variables and the map style.
   * Top-level values apply in both modes. `dark` changes them in dark mode,
   * which is on under a `.dark` class, like the CopilotKit chat. React
   * Native ignores it.
   */
  theme?: GenerativeUITheme;
  /**
   * Web only. Loads `maplibre-gl` for the standard `Map` component. Pass
   * `loadMapLibre` from `@copilotkit/react-core/generative-ui/map` and
   * install `maplibre-gl`. Without it, Map shows its markers as a list, and
   * the app builds without `maplibre-gl`. React Native ignores it.
   */
  map?: GenerativeUILibraryLoader;
  /** Fallback UI and error reporting for generated UI. */
  errorBoundary?: GenerativeUIErrorBoundaryConfig;
}

/**
 * Loads an optional library for a standard component, such as
 * `loadMapLibre` from `@copilotkit/react-core/generative-ui/map`. The
 * library stays out of apps that do not pass a loader.
 */
export type GenerativeUILibraryLoader = () => Promise<unknown>;

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
  /**
   * The latest `theme`. The host's surface root gets it: on the web it sets
   * the CSS variables; the React Native root ignores it.
   */
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
      "Generative UI components must be rendered inside a generative UI provider: <CopilotKitProvider generativeUI={{ ui }}> on the web, or <GenerativeUIProvider> from @copilotkit/react-native/generative-ui on React Native.",
    );
  }
  return runtime;
}

export { reportErrorSafely } from "@copilotkit/core/generative-ui";

export interface GenerativeUINodeContextValue {
  surfaceKey: string;
  surfaceId: string;
  componentId: string;
  /** The resolved `accessibility` of the component envelope, if any. */
  accessibility?: GenerativeUIAccessibility;
}

export const GenerativeUINodeContext =
  createContext<GenerativeUINodeContextValue | null>(null);
