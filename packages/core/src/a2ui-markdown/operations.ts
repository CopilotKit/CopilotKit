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
 * an array value) has not appeared yet. Items of a `components` array get
 * structural-key depth repair (see `repairComponentItem`).
 */
export function extractCompleteArrayItems(
  partialJson: string,
  key: string,
): { items: unknown[]; closed: boolean } | null {
  const open = findKeyValue(partialJson, key, "[");
  if (open < 0) return null;
  return completeArrayItemsAt(partialJson, open, key === "components");
}

/** Index of the last non-whitespace character before `i`, or -1. */
function prevNonWhitespace(s: string, i: number): number {
  let j = i - 1;
  while (j >= 0 && isWhitespace(s[j])) j--;
  return j;
}

/**
 * Keys that only ever belong at a component's top level. Seen nested inside
 * the component's objects, they mean the model forgot closing braces.
 */
const STRUCTURAL_KEYS = new Set(["id", "component", "child", "children"]);

/** Whether a value starting with `ch` has the shape `key` takes on a component. */
function structuralValueFits(key: string, ch: string | undefined): boolean {
  if (key === "children") return ch === "[" || ch === "{";
  return ch === '"';
}

/** `{"id":` — a new component object starting at `i`. */
const COMPONENT_START = /^\{\s*"id"\s*:/;

/**
 * Structural-key depth repair for one component item. While scanning, a
 * structural key (`id`, `component`, `child`, `children`) found as an object
 * key below the item's top level, with only objects (no arrays) between it
 * and the item root, a value of the expected shape, and not already present
 * at the top level, means closing braces were dropped: the missing `}` are
 * synthesized right before it so it lands at the top level. Containers still
 * open at the end are closed. Returns null when a string never terminates.
 */
function repairComponentItem(item: string): string | null {
  const stack: string[] = [];
  const topKeys = new Set<string>();
  let out = "";
  let copied = 0;
  for (let i = 0; i < item.length; i++) {
    const c = item[i];
    if (c === '"') {
      const end = findStringEnd(item, i);
      if (end < 0) return null;
      const prev = prevNonWhitespace(item, i);
      const prevCh = item[prev];
      const colon = skipWhitespace(item, end + 1);
      const isKey =
        stack[stack.length - 1] === "{" &&
        (prevCh === "," || prevCh === "{") &&
        item[colon] === ":";
      if (isKey) {
        let key: unknown;
        try {
          key = JSON.parse(item.slice(i, end + 1));
        } catch {
          return null;
        }
        if (typeof key === "string") {
          if (stack.length === 1) {
            topKeys.add(key);
          } else if (
            STRUCTURAL_KEYS.has(key) &&
            !topKeys.has(key) &&
            stack.every((x) => x === "{") &&
            structuralValueFits(key, item[skipWhitespace(item, colon + 1)])
          ) {
            const closers = "}".repeat(stack.length - 1);
            if (prevCh === ",") {
              out += item.slice(copied, prev) + closers;
              copied = prev;
            } else {
              // `"x":{"children":…` — close the empty object, then a comma.
              out += item.slice(copied, i) + closers + ",";
              copied = i;
            }
            stack.length = 1;
            topKeys.add(key);
          }
        }
      }
      i = end;
      continue;
    }
    if (c === "{" || c === "[") {
      stack.push(c);
    } else if (c === "}" || c === "]") {
      stack.pop();
      if (stack.length === 0) return out + item.slice(copied, i + 1);
    }
  }
  const closers = stack
    .reverse()
    .map((x) => (x === "{" ? "}" : "]"))
    .join("");
  return out + item.slice(copied) + closers;
}

function parseRecord(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Complete items of the (possibly unterminated) array whose "[" is at `open`.
 * With `repairComponents`, an item that balanced but does not parse is retried
 * with structural-key repair, and a `,{"id":` where an item expects a key
 * ends that (unbalanced) item there, so one malformed component cannot
 * swallow the rest of the array; the cut item is kept only if repair makes
 * it parse.
 */
function completeArrayItemsAt(
  partialJson: string,
  open: number,
  repairComponents = false,
): { items: unknown[]; closed: boolean } {
  const s = partialJson;
  const items: unknown[] = [];
  const stack: string[] = [];
  let inString = false;
  let itemStart = -1;

  const finishItem = (end: number, balanced: boolean) => {
    const raw = s.slice(itemStart, end);
    if (!repairComponents) {
      pushItem(raw, items);
      return;
    }
    if (balanced) {
      try {
        items.push(JSON.parse(raw));
        return;
      } catch {
        // Fall through to repair.
      }
    }
    const repaired = parseRecord(repairComponentItem(raw.trim()));
    if (repaired !== undefined) items.push(repaired);
  };

  for (let i = open + 1; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      if (stack.length === 0 && itemStart < 0) itemStart = i;
      continue;
    }
    if (c === "{" || c === "[") {
      if (
        repairComponents &&
        c === "{" &&
        stack[stack.length - 1] === "{" &&
        COMPONENT_START.test(s.slice(i, i + 24))
      ) {
        const prev = prevNonWhitespace(s, i);
        if (s[prev] === ",") {
          // A new component where a key was expected: the current item
          // is missing closers. End it before the comma and start anew.
          finishItem(prev, false);
          stack.length = 0;
          itemStart = i;
          stack.push(c);
          continue;
        }
      }
      if (stack.length === 0) itemStart = i;
      stack.push(c);
      continue;
    }
    if (c === "}" || c === "]") {
      if (stack.length === 0) {
        // Closing bracket of the items array itself (or malformed input).
        if (c === "]") {
          if (itemStart >= 0) pushItem(s.slice(itemStart, i), items);
          return { items, closed: true };
        }
        return { items, closed: false };
      }
      stack.pop();
      if (stack.length === 0) {
        finishItem(i + 1, true);
        itemStart = -1;
      }
      continue;
    }
    if (stack.length === 0) {
      if (c === ",") {
        if (itemStart >= 0) pushItem(s.slice(itemStart, i), items);
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
 * Best-effort operation from an unfinished or malformed top-level object. Fields are read only
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
    const { items } = completeArrayItemsAt(line, arrayStart, true);
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
 * A line that opens a new top-level operation: `{"version":"v…` or
 * `{"<operation>":{`. Seen at the start of a line while an earlier object is
 * still unbalanced, it means that object is malformed and has ended.
 */
const OPERATION_START =
  /^\{\s*"(?:version"\s*:\s*"v\d|(?:createSurface|updateComponents|updateDataModel|deleteSurface)"\s*:\s*\{)/;

/**
 * Scan the top-level object whose "{" is at `start`. Returns the index just
 * past it and whether it balanced. An unbalanced object ends early (at the
 * start of the line) when a line opens a new operation; otherwise it runs to
 * the end of the input. JSON strings cannot contain raw newlines, so a newline
 * inside a string ends it: a stray quote then breaks one line, not the rest of
 * the fence.
 */
function scanTopLevelObject(
  s: string,
  start: number,
): { end: number; balanced: boolean } {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === "\\" && s[i + 1] !== "\n") i++;
      else if (c === '"' || c === "\n") inString = false;
      if (c !== "\n") continue;
    }
    if (c === "\n") {
      const next = skipWhitespace(s, i + 1);
      if (OPERATION_START.test(s.slice(next, next + 40))) {
        return { end: i + 1, balanced: false };
      }
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return { end: i + 1, balanced: true };
    }
  }
  return { end: s.length, balanced: false };
}

/**
 * Parse the body of an a2ui fence as a stream of top-level JSON values, so
 * operations may be one per line (the documented format), several per line,
 * pretty-printed over many lines, or wrapped in a top-level array (which is
 * flattened). Whitespace and commas between objects are ignored.
 *
 * - A balanced object is `JSON.parse`d. When that fails (e.g. a stray quote),
 *   its raw text goes to `invalidLines` and whatever `partialOperation` can
 *   salvage (complete components, data-model entries, createSurface fields)
 *   is kept.
 * - An unbalanced object followed by a line that opens a new operation is
 *   treated the same way.
 * - The trailing unbalanced object (still streaming, or never closed) is
 *   `partialObject` and yields a partial operation when it has usable data.
 * - Other text between objects is skipped and reported in `recovered` (and in
 *   `invalidLines`, which predates it).
 *
 * `partialLine` is a deprecated alias of `partialObject`.
 */
export function extractFenceOperations(fenceText: string): {
  operations: A2UIOperation[];
  partialObject: string | null;
  partialLine: string | null;
  invalidLines: string[];
  recovered: string[];
} {
  const s = fenceText;
  const operations: A2UIOperation[] = [];
  const invalidLines: string[] = [];
  const recovered: string[] = [];
  let partialObject: string | null = null;

  const salvage = (raw: string) => {
    invalidLines.push(raw.trim());
    const partial = partialOperation(raw);
    if (partial) operations.push(partial);
  };

  let junkStart = -1;
  const flushJunk = (end: number) => {
    if (junkStart < 0) return;
    const junk = s.slice(junkStart, end).trim();
    junkStart = -1;
    if (!junk) return;
    recovered.push(junk);
    invalidLines.push(junk);
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "{") {
      flushJunk(i);
      const { end, balanced } = scanTopLevelObject(s, i);
      const raw = s.slice(i, end);
      if (balanced) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = undefined;
        }
        if (isRecord(parsed)) operations.push(parsed);
        else salvage(raw);
      } else if (end < s.length) {
        salvage(raw);
      } else {
        partialObject = raw;
        const partial = partialOperation(raw);
        if (partial) operations.push(partial);
      }
      i = end;
      continue;
    }
    if (c === "\n" || c === "[" || c === "]") {
      // A top-level array of operations is flattened by skipping its brackets.
      flushJunk(i);
    } else if (junkStart < 0 && !isWhitespace(c) && c !== ",") {
      junkStart = i;
    }
    i++;
  }
  flushJunk(s.length);

  return {
    operations,
    partialObject,
    partialLine: partialObject,
    invalidLines,
    recovered,
  };
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
