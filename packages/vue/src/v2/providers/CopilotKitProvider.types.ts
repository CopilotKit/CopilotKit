import type { AbstractAgent } from "@ag-ui/client";
import type { CopilotKitCoreErrorCode } from "@copilotkit/core";
import type { DebugConfig } from "@copilotkit/shared";
import type {
  A2UITheme,
  SandboxFunction,
  VueActivityMessageRenderer,
  VueCustomMessageRenderer,
  VueFrontendTool,
  VueHumanInTheLoop,
  VueToolCallRenderer,
} from "../types";
import type { Component } from "vue";

export interface CopilotKitProviderProps {
  runtimeUrl?: string;
  headers?: Record<string, string> | (() => Record<string, string>);
  credentials?: RequestCredentials;
  defaultThrottleMs?: number;
  publicApiKey?: string;
  publicLicenseKey?: string;
  /**
   * Signed license token for offline verification of premium features.
   * Obtain from https://cloud.copilotkit.ai.
   */
  licenseToken?: string;
  properties?: Record<string, unknown>;
  useSingleEndpoint?: boolean;
  agents__unsafe_dev_only?: Record<string, AbstractAgent>;
  selfManagedAgents?: Record<string, AbstractAgent>;
  renderToolCalls?: VueToolCallRenderer<any>[];
  renderActivityMessages?: VueActivityMessageRenderer<unknown>[];
  renderCustomMessages?: VueCustomMessageRenderer[];
  frontendTools?: VueFrontendTool[];
  humanInTheLoop?: VueHumanInTheLoop[];
  openGenerativeUI?: {
    sandboxFunctions?: SandboxFunction[];
    designSkill?: string;
  };
  showDevConsole?: boolean | "auto";
  onError?: (event: {
    error: Error;
    code: CopilotKitCoreErrorCode;
    context: Record<string, any>;
  }) => void | Promise<void>;
  a2ui?: {
    theme?: A2UITheme;
    catalog?: any;
    loadingComponent?: Component;
    includeSchema?: boolean;
  };
  /**
   * Default anchor corner for the inspector button and window.
   * Only used on first load before the user drags to a custom position.
   * Defaults to `{ horizontal: "right", vertical: "top" }`.
   */
  inspectorDefaultAnchor?: {
    horizontal: "left" | "right";
    vertical: "top" | "bottom";
  };
  /**
   * Enable debug logging for the client-side event pipeline.
   *
   * Accepts:
   * - `true` / `false` to toggle events + lifecycle logging (verbose off).
   * - `{ events?: boolean; lifecycle?: boolean; verbose?: boolean }` for granular control.
   */
  debug?: DebugConfig;
}
