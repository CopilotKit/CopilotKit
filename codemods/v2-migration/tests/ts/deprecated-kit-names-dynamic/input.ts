// Offsets after non-ASCII text (→ é) are bytes in ast-grep.
const { createCopilotNodeListener, createCopilotKitNodeListener } = require("@copilotkit/runtime/node");
const Runtime = require("@copilotkit/runtime").CopilotRuntime;
const copilotkit = require("@copilotkit/runtime");

export async function createRuntime() {
  const { CopilotRuntime, CopilotSseRuntime: Sse } = await import("@copilotkit/runtime");
  return { runtime: new CopilotRuntime({ agents: {} }), Sse };
}

export const listener = createCopilotNodeListener;
export const sameListener = createCopilotKitNodeListener;
export const intelligence = copilotkit.CopilotIntelligenceRuntime;
export const lazyHandler = async () => (await import("@copilotkit/runtime")).createCopilotRuntimeHandler;
export type Options = import("@copilotkit/runtime").CopilotRuntimeOptions;
