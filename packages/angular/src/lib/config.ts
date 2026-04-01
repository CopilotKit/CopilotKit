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
  selfManagedAgents?: Record<string, AbstractAgent>;
  tools?: ClientTool[];
  renderToolCalls?: RenderToolCallConfig[];
  frontendTools?: FrontendToolConfig[];
  humanInTheLoop?: HumanInTheLoopConfig[];
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
  const headerKey = config.headers?.[COPILOT_CLOUD_PUBLIC_API_KEY_HEADER];
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

export function provideCopilotKit(config: CopilotKitConfig): Provider {
  const resolvedLicense = resolveLicense(config);
  const headers = config.headers ?? {};
  if (!resolvedLicense.valid && resolvedLicense.warning) {
    logLicenseWatermarkWarning(resolvedLicense.warning);
  }

  const mergedHeaders = headers[COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]
    ? headers
    : !resolvedLicense.valid || !resolvedLicense.key
      ? headers
      : {
          ...headers,
          [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: resolvedLicense.key,
        };

  return {
    provide: COPILOT_KIT_CONFIG,
    useValue: {
      ...config,
      headers: mergedHeaders,
    },
  };
}
