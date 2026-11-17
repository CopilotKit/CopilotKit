import type {
  EnvironmentProviders,
  Provider,
  Signal,
  Type,
} from "@angular/core";
import { inject, InjectionToken, isDevMode } from "@angular/core";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  ClientTool,
  FrontendToolConfig,
  HumanInTheLoopConfig,
  RenderToolCallConfig,
} from "./tools";
import type { RenderActivityMessageConfig } from "./activity-renderer";
// Type-only: a VALUE import here would pull the whole `@copilotkit/core`
// dist into the app's startup graph, since `config.ts` sits on it
// (`provideCopilotKit` runs at bootstrap). `copilotkit.ts` takes the
// public-key header defaults from core (#1937's bundle-size fix).
import type {
  CopilotRuntimeTransport,
  SuggestionsConfig,
  ɵCopilotKitLearningOptions,
  ɵCopilotKitProviderBaseOptions,
} from "@copilotkit/core";
import type {
  GenerativeUI,
  GenerativeUIDefinitions,
  GenerativeUITheme,
} from "@copilotkit/shared/generative-ui";
import type { OpenGenerativeUIConfig } from "./open-generative-ui";

/**
 * The options of `provideCopilotKit`. The options shared with the React and
 * Vue providers (same names) are documented on
 * `ɵCopilotKitProviderBaseOptions` in `@copilotkit/core`.
 */
export interface CopilotKitConfig extends Pick<
  ɵCopilotKitProviderBaseOptions,
  | "runtimeUrl"
  | "headers"
  | "credentials"
  | "messageFilter"
  | "properties"
  | "selfManagedAgents"
  | "debug"
  | "defaultThrottleMs"
  | "onError"
> {
  /**
   * Transport style for CopilotKitRuntime endpoints: `"single"`, `"rest"`, or
   * `"auto"` (the default) to detect it from the runtime.
   */
  runtimeTransport?: CopilotRuntimeTransport;
  /**
   * Your CopilotKit public license key (`publicApiKey` in React and Vue).
   * With no `runtimeUrl`, CopilotKit uses Copilot Cloud.
   */
  licenseKey?: string;
  /** Local agents, keyed by id (`agents__unsafe_dev_only` in React and Vue). */
  agents?: Record<string, AbstractAgent>;
  tools?: ClientTool[];
  renderToolCalls?: RenderToolCallConfig[];
  renderActivityMessages?: RenderActivityMessageConfig[];
  suggestionsConfig?: SuggestionsConfig[];
  frontendTools?: FrontendToolConfig[];
  humanInTheLoop?: HumanInTheLoopConfig[];
  /** Opt in to a text-only renderer for otherwise unknown tool calls. */
  defaultToolRendering?: boolean;
  openGenerativeUI?: OpenGenerativeUIConfig;
  /**
   * Disable the CopilotKit Inspector in development.
   * The Inspector is enabled by default in development browser builds and is
   * always disabled in production and during server rendering.
   */
  enableInspector?: boolean;
  /**
   * Turns on interaction capture (`@copilotkit/learning`). `true` records with
   * the default options; pass an object for options. Without a sink, Core
   * authenticates with the runtime and sends browser events to Intelligence;
   * a custom sink keeps the standalone collector behavior.
   *
   * Capture starts in the browser once `CopilotKit` is created. Set
   * `trajectoryId` to use your own ID; otherwise one is generated. Set
   * `autoStart: false` to start capture yourself with
   * `copilotKit.core.startTrajectory()`. Capture stops when the application
   * is destroyed, including manually started Trajectories. Read the active ID
   * from `copilotKit.core.trajectoryId`.
   *
   * @example
   * provideCopilotKit({ runtimeUrl: "/api/copilotkit", learning: true })
   */
  learning?: boolean | ɵCopilotKitLearningOptions;
  /**
   * Set to `false` when you list `@copilotkit/core/styles.css` in your
   * `angular.json` styles, so browsers cache the CSS as a file. CopilotKit then
   * adds no `<style>` tag. For a CSP nonce, provide Angular's `CSP_NONCE`.
   * @default true
   */
  injectStyles?: boolean;
  /**
   * @deprecated Use `provideGenerativeUI` from
   * `@copilotkit/angular/generative-ui`. `provideCopilotKit` passes `a2ui` on
   * to generative UI: `a2ui: { catalog, theme }` works as
   * `provideGenerativeUI({ ui: catalog, theme })`. When the app also calls
   * `provideGenerativeUI`, its options win. The other v0.9 options
   * (`onAction`, `loadingComponent`, `recovery`, `includeSchema`) have no 2.0
   * equivalent. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui
   */
  a2ui?: {
    /**
     * A UI from `createGenerativeUI` of `@copilotkit/angular/generative-ui`.
     * It is the `ui` of `provideGenerativeUI`. Without it, generative UI
     * stays off, unless the app calls `provideGenerativeUI`.
     */
    catalog?: GenerativeUI<GenerativeUIDefinitions, Type<unknown>>;
    /**
     * Values for the `--a2ui-*` CSS variables, or a signal of them. It is the
     * `theme` of `provideGenerativeUI`.
     */
    theme?: GenerativeUITheme | Signal<GenerativeUITheme | undefined>;
  };
}

export const COPILOT_KIT_CONFIG = new InjectionToken<CopilotKitConfig>(
  "COPILOT_KIT_CONFIG",
);

export function injectCopilotKitConfig(): CopilotKitConfig {
  return inject(COPILOT_KIT_CONFIG);
}

/**
 * @internal The deprecated `a2ui` option of `provideCopilotKit`.
 * `@copilotkit/angular/generative-ui` reads it to pass its options to
 * generative UI.
 */
export const ɵCOPILOTKIT_A2UI_CONFIG = new InjectionToken<
  NonNullable<CopilotKitConfig["a2ui"]>
>("COPILOTKIT_A2UI_CONFIG");

/**
 * The generative UI providers for the catalog of the deprecated `a2ui`
 * option. `@copilotkit/angular/generative-ui` sets them when it loads: this
 * entry cannot import that one, not even lazily (ng-packagr rejects the
 * cycle). An app that passes a catalog has loaded it, because the catalog
 * comes from its `createGenerativeUI`.
 */
let a2uiGenerativeUIProviders: (() => EnvironmentProviders) | undefined;

/**
 * @internal Called by `@copilotkit/angular/generative-ui` when it loads, with
 * the providers that turn generative UI on for the deprecated `a2ui` option.
 */
export function ɵsetA2UIGenerativeUIProviders(
  providers: () => EnvironmentProviders,
) {
  a2uiGenerativeUIProviders = providers;
}

/** The generative UI providers for the catalog of the deprecated `a2ui` option. */
function a2uiCatalogProviders() {
  if (a2uiGenerativeUIProviders) return [a2uiGenerativeUIProviders()];
  if (isDevMode()) {
    console.warn(
      "[CopilotKit] The `a2ui.catalog` of `provideCopilotKit` renders with `@copilotkit/angular/generative-ui`, which the app did not load. " +
        "Create the catalog with `createGenerativeUI` from `@copilotkit/angular/generative-ui`, or add `provideGenerativeUI({ ui })` to the application providers.",
    );
  }
  return [];
}

export function provideCopilotKit(config: CopilotKitConfig = {}): Provider {
  const provider: Provider = { provide: COPILOT_KIT_CONFIG, useValue: config };
  const { a2ui } = config;
  if (!a2ui) return provider;
  // The deprecated `a2ui` option goes to generative UI.
  return [
    provider,
    { provide: ɵCOPILOTKIT_A2UI_CONFIG, useValue: a2ui },
    ...(a2ui.catalog ? a2uiCatalogProviders() : []),
  ];
}
