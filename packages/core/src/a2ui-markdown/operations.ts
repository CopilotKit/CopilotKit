/** An A2UI v0.9 message: an object carrying one of createSurface, updateComponents, updateDataModel or deleteSurface. */
export type A2UIOperation = Record<string, unknown>;

const A2UI_VERSION = "v0.9";

const OP_KEYS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
] as const;

type OperationKey = (typeof OP_KEYS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWhitespace(ch: string | undefined): boolean {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
}

function skipWhitespace(s: string, i: number): number {
  while (i < s.length && isWhitespace(s[i])) i++;
  return i;
}

/** Index of the closing quote of the JSON string opening at `start`, or -1. */
function findStringEnd(s: string, start: number): number {
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === '"') return i;
  }
  return -1;
}

/**
 * Find the first `"key":` whose value starts with `opener` and return the index
 * of that opener, or -1.
 */
function findKeyValue(s: string, key: string, opener: string): number {
  const needle = `"${key}"`;
  let from = 0;
  while (true) {
    const k = s.indexOf(needle, from);
    if (k < 0) return -1;
    let i = skipWhitespace(s, k + needle.length);
    if (s[i] === ":") {
      i = skipWhitespace(s, i + 1);
      if (s[i] === opener) return i;
    }
    from = k + 1;
  }
}

/** Read `"key":"value"` from partial JSON; null unless the closing quote has arrived. */
export function extractStringField(
  partialJson: string,
  key: string,
): string | null {
  const start = findKeyValue(partialJson, key, '"');
  if (start < 0) return null;
  const end = findStringEnd(partialJson, start);
  if (end < 0) return null;
  try {
    const value: unknown = JSON.parse(partialJson.slice(start, end + 1));
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function pushItem(raw: string, items: unknown[]): void {
  const trimmed = raw.trim();
  if (!trimmed) return;
  try {
    items.push(JSON.parse(trimmed));
  } catch {
    // Incomplete primitive; ignore until it completes.
  }
}

/**
 * Find `"key":[` in partial JSON and return every complete item of that array
 * so far, plus whether the array has closed. Returns null when the key (with
 * an array value) has not appeared yet.
 */
export function extractCompleteArrayItems(
  partialJson: string,
  key: string,
): { items: unknown[]; closed: boolean } | null {
  const open = findKeyValue(partialJson, key, "[");
  if (open < 0) return null;

  const items: unknown[] = [];
  let depth = 0;
  let inString = false;
  let itemStart = -1;

  for (let i = open + 1; i < partialJson.length; i++) {
    const c = partialJson[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      if (depth === 0 && itemStart < 0) itemStart = i;
      continue;
    }
    if (c === "{" || c === "[") {
      if (depth === 0) itemStart = i;
      depth++;
      continue;
    }
    if (c === "}" || c === "]") {
      if (depth === 0) {
        // Closing bracket of the items array itself (or malformed input).
        if (c === "]") {
          if (itemStart >= 0) pushItem(partialJson.slice(itemStart, i), items);
          return { items, closed: true };
        }
        return { items, closed: false };
      }
      depth--;
      if (depth === 0) {
        pushItem(partialJson.slice(itemStart, i + 1), items);
        itemStart = -1;
      }
      continue;
    }
    if (depth === 0) {
      if (c === ",") {
        if (itemStart >= 0) pushItem(partialJson.slice(itemStart, i), items);
        itemStart = -1;
      } else if (itemStart < 0 && !isWhitespace(c)) {
        itemStart = i; // start of a primitive item
      }
    }
  }
  return { items, closed: false };
}

function getOperationKey(op: A2UIOperation): OperationKey | undefined {
  return OP_KEYS.find((key) => isRecord(op[key]));
}

/** The surfaceId an operation targets (nested under its operation key, or top-level). */
export function getOperationSurfaceId(op: A2UIOperation): string | undefined {
  for (const key of OP_KEYS) {
    const inner = op[key];
    if (isRecord(inner) && typeof inner.surfaceId === "string") {
      return inner.surfaceId;
    }
  }
  return typeof op.surfaceId === "string" ? op.surfaceId : undefined;
}

function partialOperation(line: string): A2UIOperation | null {
  const version = extractStringField(line, "version") ?? A2UI_VERSION;
  if (findKeyValue(line, "updateComponents", "{") >= 0) {
    const components = extractCompleteArrayItems(line, "components");
    if (!components || components.items.length === 0) return null;
    const surfaceId = extractStringField(line, "surfaceId");
    return {
      version,
      updateComponents: {
        ...(surfaceId ? { surfaceId } : {}),
        components: components.items,
      },
    };
  }
  if (findKeyValue(line, "createSurface", "{") >= 0) {
    const surfaceId = extractStringField(line, "surfaceId");
    if (!surfaceId) return null;
    const catalogId = extractStringField(line, "catalogId");
    return {
      version,
      createSurface: { surfaceId, ...(catalogId ? { catalogId } : {}) },
    };
  }
  return null;
}

/**
 * Parse the body of an a2ui fence (JSONL). Complete lines are JSON-parsed; a
 * trailing line without a newline is used as-is when it already parses,
 * otherwise it yields a partial operation when it contains usable data
 * (complete components for updateComponents, or a complete surfaceId for
 * createSurface). `partialLine` is that unfinished trailing line, if any.
 */
export function extractFenceOperations(fenceText: string): {
  operations: A2UIOperation[];
  partialLine: string | null;
  invalidLines: string[];
} {
  const operations: A2UIOperation[] = [];
  const invalidLines: string[] = [];
  const lines = fenceText.split("\n");
  // When the text ends with "\n" the final element is "" and there is no trailing line.
  const last = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) operations.push(parsed);
      else invalidLines.push(trimmed);
    } catch {
      invalidLines.push(trimmed);
    }
  }

  let partialLine: string | null = null;
  const trimmedLast = last.trim();
  if (trimmedLast) {
    let complete: unknown;
    try {
      complete = JSON.parse(trimmedLast);
    } catch {
      complete = undefined;
    }
    if (isRecord(complete)) {
      operations.push(complete);
    } else {
      partialLine = last;
      const partial = partialOperation(last);
      if (partial) operations.push(partial);
    }
  }

  return { operations, partialLine, invalidLines };
}

/**
 * Normalise a fence's operations for the renderer: drop unknown messages, fill
 * in `version` and missing `surfaceId`s, default `createSurface.catalogId`,
 * synthesize `createSurface` when the model omitted it, and report the
 * surfaceId (the first one found, else `fallbackSurfaceId`).
 */
export function prepareSurfaceOperations(input: {
  operations: A2UIOperation[];
  fallbackSurfaceId: string;
  catalogId: string;
}): { surfaceId: string; operations: A2UIOperation[] } {
  const { operations, fallbackSurfaceId, catalogId } = input;
  const surfaceId =
    operations.map(getOperationSurfaceId).find((id): id is string => !!id) ??
    fallbackSurfaceId;

  const out: A2UIOperation[] = [];
  let hasCreate = false;
  for (const op of operations) {
    const key = getOperationKey(op);
    if (!key) continue;
    const inner: Record<string, unknown> = {
      ...(op[key] as Record<string, unknown>),
    };
    if (typeof inner.surfaceId !== "string") inner.surfaceId = surfaceId;
    if (key === "createSurface") {
      hasCreate = true;
      if (typeof inner.catalogId !== "string") inner.catalogId = catalogId;
    }
    out.push({
      version: typeof op.version === "string" ? op.version : A2UI_VERSION,
      [key]: inner,
    });
  }

  if (!hasCreate && out.length > 0) {
    out.unshift({
      version: A2UI_VERSION,
      createSurface: { surfaceId, catalogId },
    });
  }
  return { surfaceId, operations: out };
}
