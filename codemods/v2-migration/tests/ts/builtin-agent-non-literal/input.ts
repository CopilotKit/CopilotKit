import { BuiltInAgent } from "@copilotkit/runtime";
import { openai } from "@ai-sdk/openai";

const MODEL = "openai/gpt-5.5";
const model = MODEL;

export const fromConstant = new BuiltInAgent({ model: MODEL });
export const fromShorthand = new BuiltInAgent({ model });
export const fromLanguageModel = new BuiltInAgent({ model: openai("gpt-5.5") });
