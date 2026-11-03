import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({ agents: {} });

export const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" });

export function licenseStatus() {
  return runtime.licenseChecker?.getStatus();
}

export const checker = runtime?.licenseChecker;

export async function migratedStatus() {
  return (await runtime.getLicenseChecker())?.getStatus();
}
