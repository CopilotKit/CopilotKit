import { BuiltInAgent } from "@copilotkit/runtime";

export const agent = new BuiltInAgent({ model: "openai/gpt-5.4" });
export const mini = new BuiltInAgent({ model: "openai/gpt-5.4-mini" });
