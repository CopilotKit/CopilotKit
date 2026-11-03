import { BuiltInAgent } from "@copilotkit/runtime";

const maxSteps = 8;

export const fixed = new BuiltInAgent({ model: "openai/gpt-5.5", maxSteps: 5 });
export const shared = new BuiltInAgent({ model: "openai/gpt-5.5", maxSteps });
