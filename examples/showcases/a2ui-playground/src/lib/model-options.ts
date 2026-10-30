/**
 * The models and formats the playground offers. The server's `src/agent/models.ts` holds how each one is
 * reached, and `GET /api/models` says which can run here (the notes below show until it answers).
 */
export type ModelId = "gemini" | "gemma" | "gpt";
export type Format = "express" | "json";

export const MODEL_OPTIONS: Array<{ id: ModelId; label: string; note: string }> = [
  { id: "gemini", label: "Gemini Flash", note: "Google, default" },
  { id: "gemma", label: "Gemma 4", note: "Google, open model" },
  { id: "gpt", label: "GPT-5.5", note: "OpenAI" },
];

export const FORMAT_OPTIONS: Array<{ id: Format; label: string; hint: string }> = [
  { id: "express", label: "Express", hint: "A2UI Express: one line per component, compiled by Google's A2UI SDK" },
  { id: "json", label: "JSON", hint: "A2UI JSON: the v1.0 operations written directly, as tool-call arguments" },
];

export const modelLabel = (id: string | null | undefined) => MODEL_OPTIONS.find((m) => m.id === id)?.label ?? id ?? "";

/** One model as the picker shows it: the server's word on whether it can run here, or the defaults until it answers. */
export type ModelChoice = { id: ModelId; label: string; note: string; available: boolean; reason?: string };
