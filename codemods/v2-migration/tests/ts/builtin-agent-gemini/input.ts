import { BuiltInAgent } from "@copilotkit/runtime";

export const google = new BuiltInAgent({ model: "google/gemini-2.5-flash" });
export const gemini = new BuiltInAgent({ model: "gemini/gemini-2.5-pro" });
export const googleGemini = new BuiltInAgent({ model: "google-gemini/gemini-2.5-flash" });
