import type { AbstractAgent } from "@ag-ui/client";
import type { VueFrontendTool, VueHumanInTheLoop } from "../types";

export interface CopilotKitProviderProps {
  runtimeUrl?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  publicApiKey?: string;
  publicLicenseKey?: string;
  properties?: Record<string, unknown>;
  useSingleEndpoint?: boolean;
  agents__unsafe_dev_only?: Record<string, AbstractAgent>;
  frontendTools?: VueFrontendTool[];
  humanInTheLoop?: VueHumanInTheLoop[];
  showDevConsole?: boolean | "auto";
}
