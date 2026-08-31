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
import type { MarkdownRendererValue } from "./markdown-renderer";

export interface CopilotKitProviderProps {
  runtimeUrl?: string;
  headers?: Record<string, string> | (() => Record<string, string>);
  credentials?: RequestCredentials;
  defaultThrottleMs?: number;
  publicApiKey?: string;
  publicLicenseKey?: string;
  /**
   * Signed license token for offline verification of CopilotKit Intelligence features.
   * Obtain from https://dashboard.operations.copilotkit.ai.
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
  /**
   * @deprecated This prop no longer controls the Inspector. Use
   * `enableInspector` instead.
   */
  showDevConsole?: boolean | "auto";
  /**
   * Disable the CopilotKit Inspector in development.
   * The Inspector is enabled by default in development browser builds and is
   * always disabled in production and during server rendering.
   */
  enableInspector?: boolean;
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
   * Global markdown renderer for assistant/reasoning messages. Either a Vue
   * component (escape hatch — receives `{ content: string; isStreaming?: boolean }`)
   * or a `DefaultMarkdownRendererProps` config object (e.g.
   * `{ nodeRenderers: { codeBlock: ShikiBlock } }`) to configure the built-in
   * streaming renderer without writing a wrapper. Overrides the built-in default;
   * a per-message slot still wins.
   */
  markdownRenderer?: MarkdownRendererValue;
  /**
   * Enable debug logging for the client-side event pipeline.
   *
   * Accepts:
   * - `true` / `false` to toggle events + lifecycle logging (verbose off).
   * - `{ events?: boolean; lifecycle?: boolean; verbose?: boolean }` for granular control.
   */
  debug?: DebugConfig;
}
