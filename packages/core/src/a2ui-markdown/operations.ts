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
  return completeArrayItemsAt(partialJson, open);
}

/** Complete items of the (possibly unterminated) array whose "[" is at `open`. */
function completeArrayItemsAt(
  partialJson: string,
  open: number,
): { items: unknown[]; closed: boolean } {
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

/**
 * Index just past the JSON value starting at `start`, or -1 when the value is
 * still incomplete. A primitive at the very end of the input counts as
 * incomplete, since more digits or letters may still stream in.
 */
function findValueEnd(s: string, start: number): number {
  const c = s[start];
  if (c === '"') {
    const end = findStringEnd(s, start);
    return end < 0 ? -1 : end + 1;
  }
  if (c === "{" || c === "[") {
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"') {
        const end = findStringEnd(s, i);
        if (end < 0) return -1;
        i = end;
      } else if (ch === "{" || ch === "[") {
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }
  let i = start;
  while (i < s.length && !isWhitespace(s[i]) && !",}]".includes(s[i]!)) i++;
  return i >= s.length ? -1 : i;
}

/**
 * Walk the direct entries of the (possibly unterminated) JSON object whose "{"
 * is at `objStart`, calling `visit` with each key and the index where its value
 * starts. Nested objects and arrays are skipped whole, so keys inside them are
 * never visited. Stops when `visit` returns true, at the object's end, or where
 * the input runs out.
 */
function visitDirectEntries(
  s: string,
  objStart: number,
  visit: (key: string, valueStart: number) => boolean | void,
): void {
  let i = objStart + 1;
  while (i < s.length) {
    i = skipWhitespace(s, i);
    const c = s[i];
    if (c === ",") {
      i++;
      continue;
    }
    if (c !== '"') return; // "}" (object closed), end of input, or malformed
    const keyEnd = findStringEnd(s, i);
    if (keyEnd < 0) return;
    let key: unknown;
    try {
      key = JSON.parse(s.slice(i, keyEnd + 1));
    } catch {
      return;
    }
    i = skipWhitespace(s, keyEnd + 1);
    if (s[i] !== ":") return;
    i = skipWhitespace(s, i + 1);
    if (i >= s.length) return;
    if (typeof key === "string" && visit(key, i)) return;
    const valueEnd = findValueEnd(s, i);
    if (valueEnd < 0) return;
    i = valueEnd;
  }
}

/**
 * Value start of a direct `key` of the object at `objStart` whose value begins
 * with `opener` (any value when omitted), or -1.
 */
function findDirectKeyValue(
  s: string,
  objStart: number,
  key: string,
  opener?: string,
): number {
  let found = -1;
  visitDirectEntries(s, objStart, (k, valueStart) => {
    if (k !== key) return false;
    if (opener === undefined || s[valueStart] === opener) found = valueStart;
    return true;
  });
  return found;
}

/** A direct string field of the object at `objStart`, once its closing quote has arrived. */
function readDirectString(
  s: string,
  objStart: number,
  key: string,
): string | null {
  if (objStart < 0) return null;
  const start = findDirectKeyValue(s, objStart, key, '"');
  if (start < 0) return null;
  const end = findValueEnd(s, start);
  if (end < 0) return null;
  try {
    const value: unknown = JSON.parse(s.slice(start, end));
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * The complete part of a (possibly unterminated) JSON value: the parsed value
 * when it is complete; for an open object, its complete entries plus the
 * complete items of any streaming array entry; otherwise undefined.
 */
function completePartOfValue(s: string, start: number): unknown {
  const end = findValueEnd(s, start);
  if (end >= 0) {
    try {
      return JSON.parse(s.slice(start, end));
    } catch {
      return undefined;
    }
  }
  if (s[start] !== "{") return undefined;
  const out: Record<string, unknown> = {};
  visitDirectEntries(s, start, (key, valueStart) => {
    const valueEnd = findValueEnd(s, valueStart);
    if (valueEnd >= 0) {
      try {
        out[key] = JSON.parse(s.slice(valueStart, valueEnd));
      } catch {
        // Malformed entry; leave it out.
      }
    } else if (s[valueStart] === "[") {
      const { items } = completeArrayItemsAt(s, valueStart);
      if (items.length > 0) out[key] = items;
    }
    return false;
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Best-effort operation from an unfinished JSONL line. Fields are read only
 * from the operation's own keys (`version` at the top level, `surfaceId`,
 * `catalogId` and `path` inside the operation object), never from component
 * props or data-model values that happen to share a name.
 */
function partialOperation(line: string): A2UIOperation | null {
  const root = skipWhitespace(line, 0);
  if (line[root] !== "{") return null;
  const version = readDirectString(line, root, "version") ?? A2UI_VERSION;

  const components = findDirectKeyValue(line, root, "updateComponents", "{");
  if (components >= 0) {
    const arrayStart = findDirectKeyValue(line, components, "components", "[");
    if (arrayStart < 0) return null;
    const { items } = completeArrayItemsAt(line, arrayStart);
    if (items.length === 0) return null;
    const surfaceId = readDirectString(line, components, "surfaceId");
    return {
      version,
      updateComponents: {
        ...(surfaceId ? { surfaceId } : {}),
        components: items,
      },
    };
  }

  const data = findDirectKeyValue(line, root, "updateDataModel", "{");
  if (data >= 0) {
    const valueStart = findDirectKeyValue(line, data, "value");
    if (valueStart < 0) return null;
    const value = completePartOfValue(line, valueStart);
    if (value === undefined) return null;
    const surfaceId = readDirectString(line, data, "surfaceId");
    const path = readDirectString(line, data, "path");
    return {
      version,
      updateDataModel: {
        ...(surfaceId ? { surfaceId } : {}),
        ...(path ? { path } : {}),
        value,
      },
    };
  }

  const create = findDirectKeyValue(line, root, "createSurface", "{");
  if (create >= 0) {
    const surfaceId = readDirectString(line, create, "surfaceId");
    if (!surfaceId) return null;
    const catalogId = readDirectString(line, create, "catalogId");
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
 * (complete components for updateComponents, the complete part of the value
 * for updateDataModel, or a complete surfaceId for createSurface). `partialLine` is that unfinished trailing line, if any.
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
 * in `version` and missing `surfaceId`s, keep only the first `createSurface`,
 * force its `catalogId` to the client's `catalogId`, synthesize
 * `createSurface` when the model omitted it, and report the
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
      // A surface is created once; a repeated createSurface (e.g. a later
      // fence for the same surface) would throw "Surface already exists".
      if (hasCreate) continue;
      hasCreate = true;
      // The catalog is client-owned: whatever the model wrote is replaced.
      inner.catalogId = catalogId;
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
