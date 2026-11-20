/**
 * What the user can pick in the chat input: the Gemini model, and how the
 * canvas is drawn. The agent accepts the same model ids (GEMINI_MODELS in
 * agent/main.py) and runs anything else on its default, so keep the two lists
 * in step.
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

// The notes come from timing the same three-turn script on the Express path:
// Flash paints first (about 2.5 s), Hydrogen a little later, Neon thinks the
// longest (about 11 s before the first paint).
export const MODELS: readonly CanvasModel[] = [
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    short: "3.8 Flash",
    tiny: "Flash",
    note: "Fastest",
  },
  {
    id: "gemini-4-hydrogen",
    label: "Gemini 4 Hydrogen",
    short: "4 Hydrogen",
    tiny: "Hydrogen",
    note: "Fast",
  },
  {
    id: "gemini-4-neon",
    label: "Gemini 4 Neon",
    short: "4 Neon",
    tiny: "Neon",
    note: "Slower",
  },
];

export const DEFAULT_MODEL = MODELS[0].id;

/**
 * How the canvas is drawn. Express streams A2UI Express from one Gemini call
 * and paints it as it arrives (agent/express.py). Antigravity runs the
 * Antigravity agent, which sends the whole canvas in one tool call.
 */
export interface RenderPath {
  id: "express" | "antigravity";
  label: string;
  note: string;
}

export const RENDER_PATHS: readonly RenderPath[] = [
  { id: "express", label: "Express streaming", note: "Paints as it writes" },
  { id: "antigravity", label: "Antigravity agent", note: "All at once" },
];

export const DEFAULT_PATH: RenderPath["id"] = "express";

/** Where the choices are kept between visits. */
export const MODEL_STORAGE_KEY = "a2ui-canvas:model";
export const PATH_STORAGE_KEY = "a2ui-canvas:path";

export function modelById(id: string): CanvasModel {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function pathById(id: string): RenderPath {
  return RENDER_PATHS.find((p) => p.id === id) ?? RENDER_PATHS[0];
}
