import type { InspectorContextEntry } from "../state.js";

export function normalizeContextStore(
  context: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, InspectorContextEntry> {
  if (!context || typeof context !== "object") return {};
  const normalized: Record<string, InspectorContextEntry> = {};
  for (const [key, entry] of Object.entries(context)) {
    if (entry && typeof entry === "object" && "value" in entry) {
      const description =
        "description" in entry &&
        typeof entry.description === "string" &&
        entry.description.trim()
          ? entry.description
          : undefined;
      normalized[key] = { description, value: entry.value };
    } else {
      normalized[key] = { value: entry };
    }
  }
  return normalized;
}

export function coerceContextJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (
    !trimmed ||
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function contextValuePreview(value: unknown): string {
  const parsed = coerceContextJson(value);
  if (parsed === undefined || parsed === null) return "—";
  if (typeof parsed === "string") {
    return parsed.length > 50 ? `${parsed.slice(0, 50)}...` : parsed;
  }
  if (typeof parsed === "number" || typeof parsed === "boolean")
    return String(parsed);
  if (Array.isArray(parsed)) return `Array(${parsed.length})`;
  if (typeof parsed === "object") {
    const count = Object.keys(parsed).length;
    return `Object with ${count} key${count === 1 ? "" : "s"}`;
  }
  if (typeof parsed === "function") return "Function";
  return String(parsed);
}

export function formatContextValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "function") return value.toString();
  const parsed = coerceContextJson(value);
  if (typeof parsed === "string") return parsed;
  try {
    return JSON.stringify(parsed, null, 2) ?? String(parsed);
  } catch {
    return String(parsed);
  }
}
