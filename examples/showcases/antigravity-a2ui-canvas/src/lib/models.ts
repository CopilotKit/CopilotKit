/**
 * The Gemini models the user can pick in the chat input. The agent accepts
 * the same ids (GEMINI_MODELS in agent/main.py) and runs anything else on its
 * default, so keep the two lists in step.
 */
export interface CanvasModel {
  id: string;
  label: string;
  /** What the chip in the input shows; the menu shows the full label. */
  short: string;
  /** The chip's label when the input is narrow. */
  tiny: string;
  note: string;
}

export const MODELS: readonly CanvasModel[] = [
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    short: "3.8 Flash",
    tiny: "Flash",
    note: "Fastest",
  },
  {
    id: "gemini-4-neon",
    label: "Gemini 4 Neon",
    short: "4 Neon",
    tiny: "Neon",
    note: "Newest",
  },
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    short: "3.1 Pro",
    tiny: "Pro",
    note: "Preview",
  },
];

export const DEFAULT_MODEL = MODELS[0].id;

/** Where the chosen model is kept between visits. */
export const MODEL_STORAGE_KEY = "a2ui-canvas:model";

export function modelById(id: string): CanvasModel {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
