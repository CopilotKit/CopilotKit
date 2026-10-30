import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime";

const runtime = new CopilotRuntime({ agents: {} });

export const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit" });

export function licenseStatus() {
  return /* TODO(copilotkit-2.0): `licenseChecker` was removed in 2.0. Use `await runtime.getLicenseChecker()`, which verifies the license on first use. See https://docs.copilotkit.ai/migrate/runtime-2.0#license-checker */ runtime.licenseChecker?.getStatus();
}

export const checker = /* TODO(copilotkit-2.0): `licenseChecker` was removed in 2.0. Use `await runtime.getLicenseChecker()`, which verifies the license on first use. See https://docs.copilotkit.ai/migrate/runtime-2.0#license-checker */ runtime?.licenseChecker;

export async function migratedStatus() {
  return (await runtime.getLicenseChecker())?.getStatus();
}
