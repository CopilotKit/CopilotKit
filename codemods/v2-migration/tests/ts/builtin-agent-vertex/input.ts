import { BuiltInAgent } from "@copilotkit/runtime";

export const vertex = new BuiltInAgent({ model: "vertex/gemini-2.5-pro", temperature: 0.2 });
export const agents = {
  minimax: new BuiltInAgent({ model: "minimax/MiniMax-M2" }),
};
