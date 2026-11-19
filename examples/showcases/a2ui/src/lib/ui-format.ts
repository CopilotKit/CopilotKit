export const UI_FORMATS = [
  { id: "json", label: "JSON" },
  { id: "express", label: "Express" },
] as const;

export type UIFormat = (typeof UI_FORMATS)[number]["id"];

export const DEFAULT_UI_FORMAT: UIFormat = "json";

export function isUIFormat(value: unknown): value is UIFormat {
  return UI_FORMATS.some((format) => format.id === value);
}
