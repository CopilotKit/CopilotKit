import { CopilotRuntime } from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { openaiText } from "@tanstack/ai-openai";

const agent = new BuiltInAgent({ model: openaiText("gpt-5") });

export const runtime = new CopilotRuntime({
  agents: { shop: agent },
  generativeUI: {
    a2uiVersion: "0.9",
    agents: ["shop"],
    injectA2UITool: true,
  },
});

export const inline = new CopilotRuntime({ agents: { shop: agent }, generativeUI: { a2uiVersion: "0.9" } });

export const disabled = new CopilotRuntime({
  agents: { shop: agent },
});

export const enabled = new CopilotRuntime({
  agents: { shop: agent },
  generativeUI: { a2uiVersion: "0.9", agents: ["shop"] },
});

export const withTrue = new CopilotRuntime({
  agents: { shop: agent },
  generativeUI: {
    a2uiVersion: "0.9",
    injectA2UITool: false,
  },
});

export const withObject = new CopilotRuntime({
  agents: { shop: agent },
  generativeUI: {
    a2uiVersion: "0.9",
    injectA2UITool: true,
    agents: ["shop"],
  },
});

export const conflicting = new CopilotRuntime({
  agents: { shop: agent },
  generativeUI: { agents: ["shop"] },
  // TODO(copilotkit-2.0): The runtime `a2ui` option moved to `generativeUI: { a2uiVersion: "0.9", ...options }` in 2.0. The codemod could not move this one: its value is not an object literal, its `enabled` is not `true` or `false`, or `generativeUI` already sets one of its keys. Move it by hand, or delete it if it was off. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#before-and-after
  a2ui: { agents: ["other"] },
});

const a2uiOptions = { injectA2UITool: true };
export const fromVariable = new CopilotRuntime({
  agents: { shop: agent },
  // TODO(copilotkit-2.0): The runtime `a2ui` option moved to `generativeUI: { a2uiVersion: "0.9", ...options }` in 2.0. The codemod could not move this one: its value is not an object literal, its `enabled` is not `true` or `false`, or `generativeUI` already sets one of its keys. Move it by hand, or delete it if it was off. See https://docs.copilotkit.ai/generative-ui/components/from-a2ui#before-and-after
  a2ui: a2uiOptions,
});
