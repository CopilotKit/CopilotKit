import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import type { CopilotKitCore, RuntimeLicenseStatus } from "@copilotkit/core";

export type CoreStatusSummary = Readonly<{
  label: string;
  state: "connected" | "connecting" | "disconnected" | "error" | "unavailable";
  description: string;
}>;

export function coreSupportsInspectorMetadata(core: CopilotKitCore): boolean {
  try {
    return "inspectorMetadata" in core;
  } catch {
    return false;
  }
}

export function readCoreInspectorMetadata(core: CopilotKitCore): unknown {
  if (!coreSupportsInspectorMetadata(core)) return undefined;

  try {
    return core.inspectorMetadata;
  } catch {
    return undefined;
  }
}

export function readRuntimeLicense(
  core: CopilotKitCore | null,
): RuntimeLicenseStatus | undefined {
  try {
    return core?.licenseStatus;
  } catch {
    return undefined;
  }
}

export function getCoreStatusSummary(input: {
  hasCore: boolean;
  runtimeStatus: CopilotKitCoreRuntimeConnectionStatus | null;
  lastErrorMessage?: string;
}): CoreStatusSummary {
  if (!input.hasCore) {
    return {
      label: "Core not attached",
      state: "unavailable",
      description:
        "Pass a CopilotKitCore instance to <cpk-web-inspector> or enable auto-attach.",
    };
  }

  const status =
    input.runtimeStatus ?? CopilotKitCoreRuntimeConnectionStatus.Disconnected;
  if (status === CopilotKitCoreRuntimeConnectionStatus.Error) {
    return {
      label: "Runtime error",
      state: "error",
      description:
        input.lastErrorMessage ?? "CopilotKit runtime reported an error.",
    };
  }
  if (status === CopilotKitCoreRuntimeConnectionStatus.Connecting) {
    return {
      label: "Connecting",
      state: "connecting",
      description: "Waiting for CopilotKit runtime to finish connecting.",
    };
  }
  if (status === CopilotKitCoreRuntimeConnectionStatus.Connected) {
    return {
      label: "Connected",
      state: "connected",
      description: "Live runtime connection established.",
    };
  }
  return {
    label: "Disconnected",
    state: "disconnected",
    description:
      input.lastErrorMessage ?? "Waiting for CopilotKit runtime to connect.",
  };
}
