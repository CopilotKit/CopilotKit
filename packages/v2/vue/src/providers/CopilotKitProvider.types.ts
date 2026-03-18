import type { AbstractAgent } from "@ag-ui/client";
import type { CopilotKitCoreErrorCode } from "@copilotkitnext/core";
import type { A2UITheme, VueFrontendTool, VueHumanInTheLoop } from "../types";

export interface CopilotKitProviderProps {
  runtimeUrl?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  publicApiKey?: string;
  publicLicenseKey?: string;
  properties?: Record<string, unknown>;
  useSingleEndpoint?: boolean;
  agents__unsafe_dev_only?: Record<string, AbstractAgent>;
  selfManagedAgents?: Record<string, AbstractAgent>;
  frontendTools?: VueFrontendTool[];
  humanInTheLoop?: VueHumanInTheLoop[];
  showDevConsole?: boolean | "auto";
  onError?: (event: {
    error: Error;
    code: CopilotKitCoreErrorCode;
    context: Record<string, any>;
  }) => void | Promise<void>;
  a2ui?: {
    theme?: A2UITheme;
  };
}
