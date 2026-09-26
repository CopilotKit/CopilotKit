import type { AbstractAgent } from "@ag-ui/client";
import type {
  CopilotKitCoreRuntimeConnectionStatus,
  CopilotRuntimeTransport,
  IntelligenceRuntimeInfo,
  RuntimeLicenseStatus,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/core";
import type { CopilotKitCoreSvelte } from "../lib/svelte-core";

export interface CopilotKitContextValue {
  copilotkit: CopilotKitCoreSvelte;
  executingToolCallIds: ReadonlySet<string>;
  readonly agents: Readonly<Record<string, AbstractAgent>>;
  readonly runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
  readonly runtimeUrl: string | undefined;
  readonly runtimeTransport: CopilotRuntimeTransport;
  readonly headers: Readonly<Record<string, string>>;
  readonly threadEndpoints: ThreadEndpointRuntimeInfo | undefined;
  readonly intelligence: IntelligenceRuntimeInfo | undefined;
  readonly licenseStatus: RuntimeLicenseStatus | undefined;
}

export const COPILOT_KIT_KEY = Symbol("copilotkit");
export const COPILOT_CHAT_CONFIG_KEY = Symbol("copilotChatConfig");
