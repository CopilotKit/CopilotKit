import type { AbstractAgent } from "@ag-ui/client";
import type { CopilotKitCoreErrorCode } from "@copilotkit/core";
import type { DebugConfig } from "@copilotkit/shared";
import type {
  A2UITheme,
  SandboxFunction,
  SvelteActivityMessageRenderer,
  SvelteCustomMessageRenderer,
  SvelteFrontendTool,
  SvelteHumanInTheLoop,
  SvelteToolCallRenderer,
} from "../types";

export interface CopilotKitProviderProps {
  runtimeUrl?: string;
  headers?: Record<string, string> | (() => Record<string, string>);
  credentials?: RequestCredentials;
  defaultThrottleMs?: number;
  publicApiKey?: string;
  publicLicenseKey?: string;
  licenseToken?: string;
  properties?: Record<string, unknown>;
  useSingleEndpoint?: boolean;
  agents__unsafe_dev_only?: Record<string, AbstractAgent>;
  selfManagedAgents?: Record<string, AbstractAgent>;
  renderToolCalls?: SvelteToolCallRenderer<any>[];
  renderActivityMessages?: SvelteActivityMessageRenderer<unknown>[];
  renderCustomMessages?: SvelteCustomMessageRenderer[];
  frontendTools?: SvelteFrontendTool[];
  humanInTheLoop?: SvelteHumanInTheLoop[];
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
    includeSchema?: boolean;
  };
  inspectorDefaultAnchor?: {
    horizontal: "left" | "right";
    vertical: "top" | "bottom";
  };
  debug?: DebugConfig;
}
