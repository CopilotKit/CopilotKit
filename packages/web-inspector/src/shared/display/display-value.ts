import type { DisplayValue, SerializeDisplayValueOptions } from "./types.js";

const MAX_DISPLAY_DEPTH = 4;

function normalizeContainer(
  value: object,
  depth: number,
  ancestors: WeakSet<object>,
): DisplayValue {
  if (ancestors.has(value)) {
    return "[Circular]";
  }
  if (depth >= MAX_DISPLAY_DEPTH) {
    return "[Truncated depth]";
  }

  ancestors.add(value);
  let normalized: DisplayValue;
  if (Array.isArray(value)) {
    normalized = value.map((item) =>
      normalizeDisplayValue(item, depth + 1, ancestors),
    );
  } else {
    const entries = Object.entries(value).map(([key, entry]) => [
      key,
      normalizeDisplayValue(entry, depth + 1, ancestors),
    ]);
    normalized = Object.fromEntries(entries);
  }
  ancestors.delete(value);
  return normalized;
}

export function normalizeDisplayValue(
  value: unknown,
  depth = 0,
  ancestors = new WeakSet<object>(),
): DisplayValue {
  if (value === undefined) {
    return "[undefined]";
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    return normalizeContainer(value, depth, ancestors);
  }
  return String(value);
}

export function serializeDisplayValue(
  value: unknown,
  options: SerializeDisplayValueOptions = {},
): string {
  return JSON.stringify(
    normalizeDisplayValue(value),
    null,
    options.pretty ? 2 : 0,
  );
}
