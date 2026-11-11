import { CopilotRuntime } from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { openaiText } from "@tanstack/ai-openai";

const agent = new BuiltInAgent({ model: openaiText("gpt-5") });

export const runtime = new CopilotRuntime({
  agents: { shop: agent },
  a2ui: {
    agents: ["shop"],
    injectA2UITool: true,
  },
});

export const inline = new CopilotRuntime({ agents: { shop: agent }, a2ui: {} });

export const disabled = new CopilotRuntime({
  agents: { shop: agent },
  a2ui: { enabled: false, injectA2UITool: true },
});

export const enabled = new CopilotRuntime({
  agents: { shop: agent },
  a2ui: { enabled: true, agents: ["shop"] },
});

export const withTrue = new CopilotRuntime({
  agents: { shop: agent },
  generativeUI: true,
  a2ui: {
    injectA2UITool: false,
  },
});

export const withObject = new CopilotRuntime({
  agents: { shop: agent },
  generativeUI: {
    agents: ["shop"],
  },
  a2ui: { injectA2UITool: true },
});

export const conflicting = new CopilotRuntime({
  agents: { shop: agent },
  generativeUI: { agents: ["shop"] },
  a2ui: { agents: ["other"] },
});

const a2uiOptions = { injectA2UITool: true };
export const fromVariable = new CopilotRuntime({
  agents: { shop: agent },
  a2ui: a2uiOptions,
});
