import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { openaiText } from "@tanstack/ai-openai";

export const agent = tanstackAIAgent({ adapter: () => openaiText("gpt-5.5") });
export const mini = tanstackAIAgent({ adapter: () => openaiText("gpt-5.4-mini") });
