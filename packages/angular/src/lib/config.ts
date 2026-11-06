import type { Provider, Type } from "@angular/core";
import { inject, InjectionToken } from "@angular/core";
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
  ɵA2UIBaseOptions,
  ɵCopilotKitLearningOptions,
  ɵCopilotKitProviderBaseOptions,
} from "@copilotkit/core";
import type { OpenGenerativeUIConfig } from "./open-generative-ui";
import type { A2UICatalog } from "./components/a2ui/a2ui-types";
import type { ɵA2UIActionInterceptor } from "@copilotkit/core";

export interface A2UIConfig extends ɵA2UIBaseOptions {
  theme?: Record<string, unknown>;
  /**
   * The catalog surfaces render with: `basicCatalog`, or one from
   * `createAngularCatalog`, both in `@copilotkit/angular/a2ui`. Without one,
   * A2UI stays off, even when the runtime enables it.
   */
  catalog?: A2UICatalog;
  /** Shown until the first surface renders. */
  loadingComponent?: Type<unknown>;
  recovery?: A2UIRecoveryOptions;
  /**
   * Intercept A2UI user actions before they reach the agent: return `null`
   * to handle an action client-side (e.g. a `navigate` event), return an
   * action to forward that one instead, or return nothing to forward it
   * unchanged.
   */
  onAction?: ɵA2UIActionInterceptor;
}

export interface A2UIRecoveryOptions {
  /** Delay before revealing a transient retry. Defaults to 2000ms. */
  showAfterMs?: number;
  /** Attempt number that reveals retry state immediately. Defaults to 2. */
  showAfterAttempts?: number;
  /** Client diagnostic visibility, overridden by server lifecycle content. */
  debugExposure?: "hidden" | "collapsed" | "verbose";
}

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
   * Transport style for CopilotRuntime endpoints: `"single"`, `"rest"`, or
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
  a2ui?: A2UIConfig;
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
}

export const COPILOT_KIT_CONFIG = new InjectionToken<CopilotKitConfig>(
  "COPILOT_KIT_CONFIG",
);

export function injectCopilotKitConfig(): CopilotKitConfig {
  return inject(COPILOT_KIT_CONFIG);
}

export function provideCopilotKit(config: CopilotKitConfig = {}): Provider {
  return {
    provide: COPILOT_KIT_CONFIG,
    useValue: config,
  };
}
