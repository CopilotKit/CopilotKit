import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { openaiText } from "@tanstack/ai-openai";

const maxSteps = 8;

export const fixed = tanstackAIAgent({ adapter: () => openaiText("gpt-5.5"), maxIterations: 5 });
export const shared = tanstackAIAgent({ adapter: () => openaiText("gpt-5.5"), maxIterations: maxSteps });
