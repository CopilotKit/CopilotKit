// Offsets after non-ASCII text (→ é) are bytes in ast-grep.
const { createCopilotKitNodeListener } = require("@copilotkit/runtime/node");
const Runtime = require("@copilotkit/runtime").CopilotKitRuntime;
const copilotkit = require("@copilotkit/runtime");

export async function createRuntime() {
  const { CopilotKitRuntime, CopilotKitSseRuntime: Sse } = await import("@copilotkit/runtime");
  return { runtime: new CopilotKitRuntime({ agents: {} }), Sse };
}

export const listener = createCopilotKitNodeListener;
export const sameListener = createCopilotKitNodeListener;
export const intelligence = copilotkit.CopilotKitIntelligenceRuntime;
export const lazyHandler = async () => (await import("@copilotkit/runtime")).createCopilotKitRuntimeHandler;
export type Options = import("@copilotkit/runtime").CopilotKitRuntimeOptions;
