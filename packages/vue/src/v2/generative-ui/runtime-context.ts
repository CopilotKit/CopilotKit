import { computed, inject } from "vue";
import type { Component, InjectionKey, Ref } from "vue";
import type { GenerativeUIUserEvent } from "@copilotkit/shared";
import type {
  GenerativeUIDispatcher,
  GenerativeUISurfaceManager,
} from "@copilotkit/core/generative-ui";
import type {
  GenerativeUIErrorInfo,
  GenerativeUIInvokeResult,
  GenerativeUITheme,
} from "@copilotkit/shared/generative-ui";
import type { GenerativeUIAccessibility } from "./accessibility";
import type { GenerativeUI } from "./catalog";

export type { GenerativeUITheme };

/** The props that the `errorBoundary.fallback` component gets. */
export interface GenerativeUIErrorFallbackProps {
  error: Error;
  /** Renders the failed component again. */
  retry: () => void;
  surfaceId: string;
  componentId: string;
}

export interface GenerativeUIErrorBoundaryConfig {
  /**
   * Replaces the default per-component fallback. A Vue component that gets
   * the props of `GenerativeUIErrorFallbackProps`.
   */
  fallback?: Component;
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
 * ```vue
 * <CopilotKitProvider :generativeUI="{ ui }" />
 * <CopilotKitProvider :generativeUI="{ ui, transport: 'markdown', sendContext: false }" />
 * ```
 */
export type GenerativeUIConfig =
  | GenerativeUIToolConfig
  | GenerativeUIMarkdownConfig;

export interface GenerativeUIRuntime {
  manager: GenerativeUISurfaceManager;
  dispatcher: GenerativeUIDispatcher;
  /** The generative UI given to the provider as `:generativeUI="{ ui }"`. */
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
  /** The latest `errorBoundary.fallback` component. */
  readonly errorFallback?: Component;
}

/**
 * The runtime that the provider gives its children. It is a ref, not a plain
 * object: the provider replaces the runtime object when the `ui`, the theme,
 * or the transport changes, and a component that reads `.value` in its render
 * or in a watcher runs again. The value is `null` while the provider has no
 * `generativeUI` config.
 */
export const GenerativeUIRuntimeKey: InjectionKey<
  Readonly<Ref<GenerativeUIRuntime | null>>
> = Symbol("GenerativeUIRuntime");

const noRuntime = computed<GenerativeUIRuntime | null>(() => null);

/**
 * Experimental. The generative UI runtime of the nearest `CopilotKitProvider`,
 * as a read-only ref. Its value is `null` outside a provider, or while the
 * provider has no `generativeUI` config.
 *
 * @example
 * ```ts
 * const runtime = useGenerativeUIRuntime();
 * const transport = computed(() => runtime.value?.transport ?? "tool");
 * ```
 */
export function useGenerativeUIRuntime() {
  return inject(GenerativeUIRuntimeKey, noRuntime);
}

const MISSING_RUNTIME_MESSAGE =
  'Generative UI components must be rendered inside <CopilotKitProvider :generativeUI="{ ui }">.';

/**
 * The generative UI runtime of the nearest provider, as a read-only ref
 * whose value is never `null`.
 *
 * @throws Error when it is called outside a provider with a `generativeUI`
 *   config. Reading `.value` throws the same error after the provider loses
 *   its config.
 */
export function useRequiredGenerativeUIRuntime() {
  const runtime = useGenerativeUIRuntime();
  if (!runtime.value) throw new Error(MISSING_RUNTIME_MESSAGE);
  return computed(() => {
    const current = runtime.value;
    if (!current) throw new Error(MISSING_RUNTIME_MESSAGE);
    return current;
  });
}

export { reportErrorSafely } from "@copilotkit/core/generative-ui";

export interface GenerativeUINodeContextValue {
  surfaceKey: string;
  surfaceId: string;
  componentId: string;
  /** The resolved `accessibility` of the component envelope, if any. */
  accessibility?: GenerativeUIAccessibility;
}

/**
 * The node being rendered, which each generated component's renderer
 * provides. A ref, because the resolved `accessibility` can change while the
 * node stays mounted.
 */
export const GenerativeUINodeKey: InjectionKey<
  Readonly<Ref<GenerativeUINodeContextValue>>
> = Symbol("GenerativeUINode");
