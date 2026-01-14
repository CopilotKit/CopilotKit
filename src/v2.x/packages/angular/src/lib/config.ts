import { inject, InjectionToken, Provider } from "@angular/core";
import { AbstractAgent } from "@ag-ui/client";
import {
  ClientTool,
  FrontendToolConfig,
  HumanInTheLoopConfig,
  RenderToolCallConfig,
} from "./tools";

export interface CopilotKitConfig {
  runtimeUrl?: string;
  headers?: Record<string, string>;
  licenseKey?: string;
  properties?: Record<string, unknown>;
  agents?: Record<string, AbstractAgent>;
  tools?: ClientTool[];
  renderToolCalls?: RenderToolCallConfig[];
  frontendTools?: FrontendToolConfig[];
  humanInTheLoop?: HumanInTheLoopConfig[];
}

const COPILOT_CLOUD_PUBLIC_API_KEY_HEADER = "X-CopilotCloud-Public-Api-Key";
const COPILOT_CLOUD_PUBLIC_API_KEY_REGEX = /^ck_pub_[0-9a-f]{32}$/i;

function validateLicenseKey(licenseKey: string | undefined): string {
  if (!licenseKey) {
    throw new Error(
      "Missing required Copilot Cloud license key. Set `licenseKey` in provideCopilotKit().",
    );
  }

  if (!COPILOT_CLOUD_PUBLIC_API_KEY_REGEX.test(licenseKey)) {
    throw new Error(
      "Invalid Copilot Cloud license key format. Expected ck_pub_ followed by 32 hex characters.",
    );
  }

  return licenseKey;
}

export const COPILOT_KIT_CONFIG = new InjectionToken<CopilotKitConfig>(
  "COPILOT_KIT_CONFIG"
);

export function injectCopilotKitConfig(): CopilotKitConfig {
  return inject(COPILOT_KIT_CONFIG);
}

export function provideCopilotKit(config: CopilotKitConfig): Provider {
  const licenseKey = validateLicenseKey(config.licenseKey);
  const headers = config.headers ?? {};
  const mergedHeaders = headers[COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]
    ? headers
    : {
        ...headers,
        [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: licenseKey,
      };

  return {
    provide: COPILOT_KIT_CONFIG,
    useValue: {
      ...config,
      headers: mergedHeaders,
    },
  };
}
