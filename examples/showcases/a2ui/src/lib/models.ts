/** Keep in sync with MODELS in `agent/src/research_desk/agent.py`. */
export const MODELS = [
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    note: "Fast, the default",
  },
  { id: "gemini-4-argon", label: "Gemini 4 Argon", note: "Most capable" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", note: "Deliberate" },
] as const;

export type ModelId = (typeof MODELS)[number]["id"];

export const DEFAULT_MODEL: ModelId = "gemini-3.8-flash";

export function isModelId(value: unknown): value is ModelId {
  return MODELS.some((model) => model.id === value);
}
