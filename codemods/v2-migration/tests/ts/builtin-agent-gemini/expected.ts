import { tanstackAIAgent } from "@copilotkit/runtime/tanstack-ai";
import { geminiText } from "@tanstack/ai-gemini";

export const google = tanstackAIAgent({ adapter: geminiText("gemini-2.5-flash") });
export const gemini = tanstackAIAgent({ adapter: geminiText("gemini-2.5-pro") });
export const googleGemini = tanstackAIAgent({ adapter: geminiText("gemini-2.5-flash") });
