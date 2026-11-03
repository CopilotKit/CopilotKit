import type { Provider, Type } from "@angular/core";
import { inject, InjectionToken } from "@angular/core";
import type { AbstractAgent } from "@ag-ui/client";
import type {
  ClientTool,
  FrontendToolConfig,
  HumanInTheLoopConfig,
  RenderToolCallConfig,
} from "./tools";
import { LICENSE_WATERMARK_ENABLED } from "./license-watermark";
import type { RenderActivityMessageConfig } from "./activity-renderer";
// Type-only: a VALUE import here would pull the whole `@copilotkit/core`
// dist into the app's startup graph, since `config.ts` sits on it
// (`provideCopilotKit` runs at bootstrap). The public-key header default is
// wrapped in `copilotkit.ts` instead, which already imports core at runtime
// (see `ɵresolvePublicKeyHeaderDefaults` below and #1937's bundle-size fix).
import type {
  CopilotRuntimeTransport,
  SuggestionsConfig,
  ɵA2UIBaseOptions,
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
   * Set to `false` when you list `@copilotkit/core/styles.css` in your
   * `angular.json` styles, so browsers cache the CSS as a file. CopilotKit then
   * adds no `<style>` tag. For a CSP nonce, provide Angular's `CSP_NONCE`.
   * @default true
   */
  injectStyles?: boolean;
}

const COPILOT_CLOUD_PUBLIC_API_KEY_HEADER = "X-CopilotCloud-Public-Api-Key";
const COPILOT_CLOUD_PUBLIC_API_KEY_REGEX = /^ck_pub_[0-9a-f]{32}$/i;
const LICENSE_WATERMARK_LOG_FLAG = "__copilotkitAngularLicenseWatermarkLogged";

type ResolvedLicense = {
  key?: string;
  valid: boolean;
  warning?: string;
};

function logLicenseWatermarkWarning(message: string): void {
  const globalWindow = globalThis as typeof globalThis & {
    [LICENSE_WATERMARK_LOG_FLAG]?: boolean;
  };
  if (globalWindow[LICENSE_WATERMARK_LOG_FLAG]) {
    return;
  }
  globalWindow[LICENSE_WATERMARK_LOG_FLAG] = true;

  console.warn(
    [
      "========================================",
      "[CopilotKit] License Required",
      message,
      "Get your CopilotCloud license key and add it as `licenseKey` to remove this watermark.",
      "========================================",
    ].join("\n"),
  );
}

function resolveLicense(config: CopilotKitConfig): ResolvedLicense {
  // A builder is only evaluated at send time, so it can't be read here. Rely
  // on `licenseKey` in that case (same fallback the record branch already has).
  const headerKey =
    typeof config.headers === "function"
      ? undefined
      : config.headers?.[COPILOT_CLOUD_PUBLIC_API_KEY_HEADER];
  const key = config.licenseKey ?? headerKey;

  if (!key) {
    return {
      valid: false,
      warning:
        "No CopilotCloud license key was found. A watermark will be shown until one is added.",
    };
  }

  if (!COPILOT_CLOUD_PUBLIC_API_KEY_REGEX.test(key)) {
    return {
      key,
      valid: false,
      warning:
        "Your CopilotCloud license key appears invalid. A watermark will be shown until a valid key is added.",
    };
  }

  return { key, valid: true };
}

export const COPILOT_KIT_CONFIG = new InjectionToken<CopilotKitConfig>(
  "COPILOT_KIT_CONFIG",
);

export function injectCopilotKitConfig(): CopilotKitConfig {
  return inject(COPILOT_KIT_CONFIG);
}

/**
 * @deprecated `CopilotKit` no longer uses this: it takes the header defaults
 * from `ɵresolveProviderConfig` in `@copilotkit/core`, which sends any
 * `licenseKey` (the React and Vue behavior). Kept for the exported API.
 *
 * The public-key header default `provideCopilotKit` used to merge directly
 * into `config.headers` (main's behavior, record-only). Now that `headers`
 * can be a builder (#1937), the merge can't happen here — a builder is only
 * evaluated at send time — so `copilotkit.ts` applies these defaults itself,
 * via `ɵwithHeaderDefaults`, where `CopilotKitCore` is constructed and
 * wherever `setHeaders` is called. Kept in this file (rather than
 * `copilotkit.ts`) so the license-key condition has one definition, shared
 * with `resolveLicense`'s watermark check below; this function itself stays
 * a plain computation with no `@copilotkit/core` value import.
 */
export function ɵresolvePublicKeyHeaderDefaults(
  config: CopilotKitConfig,
): Record<string, string> {
  const resolvedLicense = resolveLicense(config);
  return !resolvedLicense.valid || !resolvedLicense.key
    ? {}
    : { [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: resolvedLicense.key };
}

export function provideCopilotKit(config: CopilotKitConfig = {}): Provider {
  const resolvedLicense = resolveLicense(config);
  if (
    LICENSE_WATERMARK_ENABLED &&
    !resolvedLicense.valid &&
    resolvedLicense.warning
  ) {
    logLicenseWatermarkWarning(resolvedLicense.warning);
  }

  return {
    provide: COPILOT_KIT_CONFIG,
    useValue: config,
  };
}
