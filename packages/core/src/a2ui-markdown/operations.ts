import { A2UI_VERSION, GENERATIVE_UI_ROOT_ID } from "@copilotkit/shared";

/**
 * An A2UI v1.0 message as the model wrote it in an a2ui fence: an object that
 * carries one of createSurface, updateComponents, updateDataModel,
 * deleteSurface or callRendererFunction. The shape is not checked yet.
 * Validate it (for example with `validateOperation` from `@copilotkit/shared`)
 * before it reaches a surface or runs a function.
 *
 * It is named `A2UIMarkdownOperation` because `@copilotkit/shared` already
 * exports the strict `A2UIOperation` type.
 */
export type A2UIMarkdownOperation = Record<string, unknown>;

/** The operation keys that change a surface. */
const SURFACE_OP_KEYS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
] as const;

/** The operation key of an agent-called function. It has no surface. */
const FUNCTION_CALL_KEY = "callRendererFunction";

const OP_KEYS = [...SURFACE_OP_KEYS, FUNCTION_CALL_KEY] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWhitespace(ch: string | undefined) {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
}

function skipWhitespace(s: string, i: number) {
  while (i < s.length && isWhitespace(s[i])) i++;
  return i;
}

/** Index of the closing quote of the JSON string opening at `start`, or -1. */
function findStringEnd(s: string, start: number) {
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
function findKeyValue(s: string, key: string, opener: string) {
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

/**
 * Read `"key":"value"` from partial JSON. The first match anywhere in the
 * text wins, at any depth.
 *
 * @param partialJson - JSON text that can still be streaming.
 * @param key - The field name.
 * @returns The string value, or null until its closing quote has arrived.
 *
 * @example
 * ```ts
 * extractStringField('{"createSurface":{"surfaceId":"plan","cat', "surfaceId"); // "plan"
 * ```
 */
export function extractStringField(partialJson: string, key: string) {
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

function pushItem(raw: string, items: unknown[]) {
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
 * so far, plus whether the array has closed. Items of a `components` array get
 * structural-key depth repair: a component that lost closing braces is fixed
 * when its `id`, `component`, `child` or `children` key shows where it ends.
 *
 * @param partialJson - JSON text that can still be streaming.
 * @param key - The name of the array field.
 * @returns `{ items, closed }`, or null when the key (with an array value)
 * has not appeared yet.
 *
 * @example
 * ```ts
 * const result = extractCompleteArrayItems(streamedText, "components");
 * if (result) render(result.items);
 * ```
 */
export function extractCompleteArrayItems(partialJson: string, key: string) {
  const open = findKeyValue(partialJson, key, "[");
  if (open < 0) return null;
  return completeArrayItemsAt(partialJson, open, {
    repairComponents: key === "components",
  });
}

/** Index of the last non-whitespace character before `i`, or -1. */
function prevNonWhitespace(s: string, i: number) {
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
function structuralValueFits(key: string, ch: string | undefined) {
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
function repairComponentItem(item: string) {
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
  // Close the open brackets, innermost first.
  const closers = stack.reduceRight(
    (text, opener) => text + (opener === "{" ? "}" : "]"),
    "",
  );
  return out + item.slice(copied) + closers;
}

function parseRecord(text: string | null) {
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
  options: { repairComponents: boolean },
) {
  const { repairComponents } = options;
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

/** The first operation key whose value is an object, with that value. */
function getOperationEntry(op: A2UIMarkdownOperation) {
  for (const key of OP_KEYS) {
    const inner = op[key];
    if (isRecord(inner)) return { key, inner };
  }
  return null;
}

/**
 * The surfaceId an operation targets: the one nested under its operation key,
 * else a top-level `surfaceId`. A `callRendererFunction` operation targets no
 * surface, so it gets undefined.
 *
 * It is named `getMarkdownOperationSurfaceId` because `@copilotkit/shared`
 * already exports a strict `getOperationSurfaceId`. This one also reads a
 * top-level `surfaceId`, which models sometimes write.
 *
 * @param op - An operation from an a2ui fence.
 * @returns The surfaceId, or undefined when the operation names none or is a
 * function call.
 *
 * @example
 * ```ts
 * getMarkdownOperationSurfaceId({ updateDataModel: { surfaceId: "plan" } }); // "plan"
 * ```
 */
export function getMarkdownOperationSurfaceId(op: A2UIMarkdownOperation) {
  if (getOperationEntry(op)?.key === FUNCTION_CALL_KEY) return undefined;
  for (const key of SURFACE_OP_KEYS) {
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
function findValueEnd(s: string, start: number) {
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
  visit: (key: string, valueStart: number) => boolean,
) {
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
) {
  let found = -1;
  visitDirectEntries(s, objStart, (k, valueStart) => {
    if (k !== key) return false;
    if (opener === undefined || s[valueStart] === opener) found = valueStart;
    return true;
  });
  return found;
}

/** A direct string field of the object at `objStart`, once its closing quote has arrived. */
function readDirectString(s: string, objStart: number, key: string) {
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

/** A direct object field of the object at `objStart`, once the whole object has arrived. */
function readDirectRecord(s: string, objStart: number, key: string) {
  const start = findDirectKeyValue(s, objStart, key, "{");
  if (start < 0) return undefined;
  const end = findValueEnd(s, start);
  if (end < 0) return undefined;
  return parseRecord(s.slice(start, end));
}

/**
 * The complete part of a (possibly unterminated) JSON value: the parsed value
 * when it is complete; for an open object, its complete entries plus the
 * complete items of any streaming array entry; otherwise undefined.
 */
function completePartOfValue(s: string, start: number) {
  const end = findValueEnd(s, start);
  if (end >= 0) {
    try {
      const value: unknown = JSON.parse(s.slice(start, end));
      return value;
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
      const { items } = completeArrayItemsAt(s, valueStart, {
        repairComponents: false,
      });
      if (items.length > 0) out[key] = items;
    }
    return false;
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Best-effort operation from an unfinished or malformed top-level object.
 * Fields are read only from the operation's own keys (`version` at the top
 * level, `surfaceId`, `catalogId`, `path`, `dataModel` and `components` inside
 * the operation object), never from component props or data-model values that
 * happen to share a name.
 *
 * A `createSurface` keeps its complete components and a `dataModel` that has
 * fully arrived, so a surface created in one line renders while it streams.
 * A `callRendererFunction` gives nothing: a function must not run with half
 * of its args.
 */
function partialOperation(line: string) {
  const root = skipWhitespace(line, 0);
  if (line[root] !== "{") return null;
  const version = readDirectString(line, root, "version") ?? A2UI_VERSION;

  const components = findDirectKeyValue(line, root, "updateComponents", "{");
  if (components >= 0) {
    const arrayStart = findDirectKeyValue(line, components, "components", "[");
    if (arrayStart < 0) return null;
    const { items } = completeArrayItemsAt(line, arrayStart, {
      repairComponents: true,
    });
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
    const dataModel = readDirectRecord(line, create, "dataModel");
    const componentsStart = findDirectKeyValue(line, create, "components", "[");
    const components =
      componentsStart < 0
        ? []
        : completeArrayItemsAt(line, componentsStart, {
            repairComponents: true,
          }).items;
    return {
      version,
      createSurface: {
        surfaceId,
        ...(catalogId ? { catalogId } : {}),
        ...(dataModel ? { dataModel } : {}),
        ...(components.length > 0 ? { components } : {}),
      },
    };
  }
  return null;
}

/**
 * A line that opens a new top-level operation: `{"version":"v…` or
 * `{"<operation>":{`. Seen at the start of a line while an earlier object is
 * still unbalanced, it means that object is malformed and has ended.
 */
const OPERATION_START = new RegExp(
  `^\\{\\s*"(?:version"\\s*:\\s*"v\\d|(?:${OP_KEYS.join("|")})"\\s*:\\s*\\{)`,
);

/**
 * Scan the top-level object whose "{" is at `start`. Returns the index just
 * past it and whether it balanced. An unbalanced object ends early (at the
 * start of the line) when a line opens a new operation; otherwise it runs to
 * the end of the input. JSON strings cannot contain raw newlines, so a newline
 * inside a string ends it: a stray quote then breaks one line, not the rest of
 * the fence.
 */
function scanTopLevelObject(s: string, start: number) {
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
 *
 * @param fenceText - The body of an a2ui fence (`text` of an a2ui
 * `MarkdownSegment`), complete or still streaming.
 * @returns `{ operations, partialObject, partialLine, invalidLines, recovered }`.
 *
 * @example
 * ```ts
 * const { operations } = extractFenceOperations(segment.text);
 * ```
 */
export function extractFenceOperations(fenceText: string) {
  const s = fenceText;
  const operations: A2UIMarkdownOperation[] = [];
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
 * keep its `catalogId` when `catalogIds` lists it (else use `catalogId`), synthesize
 * `createSurface` when the model omitted it, and report the
 * surfaceId (the first one found, else `fallbackSurfaceId`).
 *
 * `callRendererFunction` operations target no surface. They get no surfaceId,
 * do not cause a synthesized `createSurface`, and come back in
 * `functionCalls` (in fence order), never in `operations`.
 *
 * @param input.operations - Operations from `extractFenceOperations`.
 * @param input.fallbackSurfaceId - The surfaceId to use when no operation
 * names one.
 * @param input.catalogId - The client catalog. It replaces a catalogId of the
 * model that `catalogIds` does not list.
 * @param input.catalogIds - The catalogs that the model can name. Left out,
 * only `catalogId`.
 * @returns `{ surfaceId, operations, functionCalls }`.
 *
 * @example
 * ```ts
 * const { surfaceId, operations, functionCalls } = prepareSurfaceOperations({
 *   operations: extractFenceOperations(segment.text).operations,
 *   fallbackSurfaceId: `${messageId}-${segment.index}`,
 *   catalogId,
 * });
 * ```
 */
export function prepareSurfaceOperations(input: {
  operations: A2UIMarkdownOperation[];
  fallbackSurfaceId: string;
  catalogId: string;
  catalogIds?: readonly string[];
}) {
  const { operations, fallbackSurfaceId, catalogId } = input;
  const catalogIds = input.catalogIds ?? [catalogId];
  const surfaceId =
    operations
      .map(getMarkdownOperationSurfaceId)
      .find((id): id is string => !!id) ?? fallbackSurfaceId;

  const out: A2UIMarkdownOperation[] = [];
  const functionCalls: A2UIMarkdownOperation[] = [];
  let hasCreate = false;
  for (const op of operations) {
    const entry = getOperationEntry(op);
    if (!entry) continue;
    const { key } = entry;
    const inner = { ...entry.inner };
    const version = typeof op.version === "string" ? op.version : A2UI_VERSION;
    if (key === FUNCTION_CALL_KEY) {
      functionCalls.push({ version, [key]: inner });
      continue;
    }
    if (typeof inner.surfaceId !== "string") inner.surfaceId = surfaceId;
    if (key === "createSurface") {
      // A surface is created once; a repeated createSurface (e.g. a later
      // reply that rebuilds a page target) would throw "Surface already
      // exists". Its data model and components become updates instead, so
      // the new UI is not lost.
      if (hasCreate) {
        const { surfaceId: id, dataModel, components } = inner;
        if (dataModel !== undefined) {
          out.push({
            version,
            updateDataModel: { surfaceId: id, path: "/", value: dataModel },
          });
        }
        if (Array.isArray(components) && components.length > 0) {
          out.push({
            version,
            updateComponents: { surfaceId: id, components },
          });
        }
        continue;
      }
      hasCreate = true;
      // The catalog is client-owned: a catalog that the client does not
      // list is replaced.
      if (!catalogIds.includes(inner.catalogId as string)) {
        inner.catalogId = catalogId;
      }
    }
    out.push({ version, [key]: inner });
  }

  if (!hasCreate && out.length > 0) {
    out.unshift({
      version: A2UI_VERSION,
      createSurface: { surfaceId, catalogId },
    });
  }
  return { surfaceId, operations: out, functionCalls };
}

/**
 * Components a user operates. A Card containing one of these is an
 * interactive panel and keeps its box; every other Card is informational.
 */
const INTERACTIVE_COMPONENTS = new Set([
  "Button",
  "Pressable",
  "Form",
  "TextField",
  "TextArea",
  "Select",
  "CheckBox",
  "Radio",
  "RadioGroup",
  "Slider",
  "SegmentedControl",
  "ChoicePicker",
  "DateTimeInput",
]);

/** A component id referenced by a `child`/`children` entry or a table cell. */
function referencedId(value: unknown) {
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    if (typeof value.componentId === "string") return value.componentId;
    if (typeof value.id === "string") return value.id;
  }
  return undefined;
}

/** Ids of a table cell / column that renders a component (`{componentId}` or `{id}`). */
function cellComponentId(value: unknown) {
  return isRecord(value) ? referencedId(value) : undefined;
}

/**
 * More ids a component renders, beyond `child`, `children` and the table
 * cells: the typed child references of its catalog, which can sit at any
 * depth of its props (the `child` of each entry of `tabs`). The catalog
 * knows them; the operations alone do not.
 */
export type ChildIdsOf = (
  component: Record<string, unknown>,
) => string[] | "unknown";

/** The options of the walks that follow child ids. */
export interface ChildWalkOptions {
  childIds?: ChildIdsOf;
}

/**
 * Ids a component renders directly: `child`, `children` (string ids, an
 * array, or a `{componentId}` template), component cells of a Table's
 * `rows`/`columns`, and the ids that `extra` finds in its typed references.
 */
function directChildIds(
  component: Record<string, unknown>,
  extra?: ChildIdsOf,
) {
  const ids: string[] = [];
  const add = (id: string | undefined) => {
    if (id) ids.push(id);
  };
  const extraIds = extra?.(component);
  if (Array.isArray(extraIds)) extraIds.forEach(add);
  add(referencedId(component.child));
  const children = component.children;
  if (Array.isArray(children)) children.forEach((c) => add(referencedId(c)));
  else add(referencedId(children));
  if (Array.isArray(component.columns)) {
    component.columns.forEach((c) => add(cellComponentId(c)));
  }
  if (Array.isArray(component.rows)) {
    for (const row of component.rows) {
      if (Array.isArray(row)) row.forEach((c) => add(cellComponentId(c)));
    }
  }
  return ids;
}

/** Components of every updateComponents operation, by id (last definition wins). */
function componentsById(operations: A2UIMarkdownOperation[]) {
  const byId = new Map<string, Record<string, unknown>>();
  for (const op of operations) {
    const update = op.updateComponents;
    const list = isRecord(update) ? update.components : undefined;
    if (!Array.isArray(list)) continue;
    for (const c of list) {
      if (isRecord(c) && typeof c.id === "string") byId.set(c.id, c);
    }
  }
  return byId;
}

function descendantIds(
  rootId: string,
  byId: Map<string, Record<string, unknown>>,
  extra?: ChildIdsOf,
) {
  const seen = new Set<string>();
  const stack = [...directChildIds(byId.get(rootId) ?? {}, extra)];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id) || id === rootId) continue;
    seen.add(id);
    const c = byId.get(id);
    if (c) stack.push(...directChildIds(c, extra));
  }
  return seen;
}

/**
 * Ids of the `Card` components that are interactive panels: at least one
 * descendant (via `child`, `children` or table component cells) is a control
 * (Button, Pressable, Form, TextField, TextArea, Select, CheckBox, Radio,
 * RadioGroup, Slider, SegmentedControl, DateTimeInput).
 *
 * @param components - The components of one surface.
 * @returns The ids of the interactive cards.
 *
 * @example
 * ```ts
 * const interactive = classifySurfaceCards(components);
 * const keepsBox = interactive.has("quote-form");
 * ```
 */
export function classifySurfaceCards(
  components: Record<string, unknown>[],
  options: ChildWalkOptions = {},
) {
  const byId = new Map<string, Record<string, unknown>>();
  for (const c of components) {
    if (isRecord(c) && typeof c.id === "string") byId.set(c.id, c);
  }
  const interactive = new Set<string>();
  for (const [id, c] of byId) {
    if (c.component !== "Card") continue;
    for (const d of descendantIds(id, byId, options.childIds)) {
      const type = byId.get(d)?.component;
      if (typeof type === "string" && INTERACTIVE_COMPONENTS.has(type)) {
        interactive.add(id);
        break;
      }
    }
  }
  return interactive;
}

/**
 * Markdown mode: only interactive panels keep a box. Every `Card` that is not
 * an interactive panel (see `classifySurfaceCards`), sets no `variant` or
 * `border` of its own and is not nested inside an interactive panel becomes
 * `variant: "section"` (a heading plus content without a box). Operations
 * other than updateComponents pass through unchanged.
 *
 * @param operations - The operations of one surface.
 * @returns The operations with informational cards set to `variant: "section"`.
 * When no card changes, it returns the same array.
 *
 * @example
 * ```ts
 * const operations = flattenInformationalCards(prepared.operations);
 * ```
 */
export function flattenInformationalCards(
  operations: A2UIMarkdownOperation[],
  options: ChildWalkOptions = {},
) {
  const byId = componentsById(operations);
  if (![...byId.values()].some((c) => c.component === "Card")) {
    return operations;
  }
  const interactive = classifySurfaceCards([...byId.values()], options);
  const insideInteractive = new Set<string>();
  for (const id of interactive) {
    for (const d of descendantIds(id, byId, options.childIds)) {
      insideInteractive.add(d);
    }
  }
  const flatten = (c: Record<string, unknown>) =>
    c.component === "Card" &&
    typeof c.id === "string" &&
    !interactive.has(c.id) &&
    !insideInteractive.has(c.id) &&
    c.variant == null &&
    c.border == null;

  const flattened: A2UIMarkdownOperation[] = operations.map((op) => {
    const update = op.updateComponents;
    if (!isRecord(update) || !Array.isArray(update.components)) return op;
    if (!update.components.some((c) => isRecord(c) && flatten(c))) return op;
    return {
      ...op,
      updateComponents: {
        ...update,
        components: update.components.map((c) =>
          isRecord(c) && flatten(c) ? { ...c, variant: "section" } : c,
        ),
      },
    };
  });
  return flattened;
}

/** Text-bearing components that belong in the chat's markdown, not a surface. */
const PROSE_TEXT_COMPONENTS = new Set(["Title", "Text", "Caption", "Markdown"]);

/** A component that converts to markdown: text-bearing prose, or a separator next to it. */
type ProseItem =
  | { kind: "text"; markdown: string }
  | { kind: "divider" | "spacer" };

/** One line of text: list items and headings cannot span lines in markdown. */
function oneLine(text: string) {
  return text.trim().replace(/\s*\n\s*/g, " ");
}

/**
 * A literal List entry as list-item markdown: a non-empty string, or
 * `{ label, description? }` with literal strings only. Anything carrying
 * behaviour or decoration (`icon`, `action`, other keys, bound values) is null.
 */
function listEntryMarkdown(entry: unknown) {
  if (typeof entry === "string") return entry.trim() ? oneLine(entry) : null;
  if (!isRecord(entry)) return null;
  for (const key of Object.keys(entry)) {
    if (key !== "label" && key !== "description") return null;
  }
  if (typeof entry.label !== "string" || !entry.label.trim()) return null;
  const label = oneLine(entry.label);
  if (entry.description === undefined) return label;
  if (typeof entry.description !== "string") return null;
  return entry.description.trim()
    ? `**${label}** — ${oneLine(entry.description)}`
    : label;
}

/**
 * A List of literal text items as a markdown list (`marker: "number"` →
 * `1. …`, otherwise `- …`), or null when it binds its items, renders
 * `children`, or any item is not plain text.
 */
function listToMarkdown(c: Record<string, unknown>) {
  const children = c.children;
  if (children != null && !(Array.isArray(children) && children.length === 0)) {
    return null;
  }
  if (!Array.isArray(c.items) || c.items.length === 0) return null;
  const lines: string[] = [];
  for (const entry of c.items) {
    const line = listEntryMarkdown(entry);
    if (line === null) return null;
    lines.push(line);
  }
  if (c.marker === "number") {
    const start =
      typeof c.start === "number" && Number.isInteger(c.start) ? c.start : 1;
    return lines.map((line, i) => `${start + i}. ${line}`).join("\n");
  }
  return lines.map((line) => `- ${line}`).join("\n");
}

/** The prose item a component converts to, or null when it is not prose. */
function toProseItem(c: Record<string, unknown> | undefined) {
  if (!c) return null;
  // A component with an accessibility envelope stays a component: markdown
  // has no place for its label, its live region or its hidden state.
  if (c.accessibility !== undefined) return null;
  if (c.component === "Divider") return { kind: "divider" as const };
  if (c.component === "Spacer") return { kind: "spacer" as const };
  if (c.component === "List") {
    // A horizontal list is a layout, not a text list; a bound direction
    // may be horizontal at render time.
    if (c.direction !== undefined && c.direction !== "vertical") return null;
    const markdown = listToMarkdown(c);
    return markdown === null ? null : { kind: "text" as const, markdown };
  }
  if (typeof c.component !== "string") return null;
  if (!PROSE_TEXT_COMPONENTS.has(c.component)) return null;
  // Only literal strings are prose; `{path}`-bound text is data.
  if (typeof c.text !== "string" || c.text.trim() === "") return null;
  const text = c.text.trim();
  switch (c.component) {
    case "Title": {
      const size = typeof c.size === "string" ? c.size : "md";
      const level =
        size === "sm" ? "####" : size === "md" || size === "lg" ? "###" : "##";
      return { kind: "text" as const, markdown: `${level} ${text}` };
    }
    case "Text":
      // Inline children (e.g. a Badge) have no markdown form.
      if (directChildIds(c).length > 0) return null;
      return {
        kind: "text" as const,
        markdown: c.strong === true ? `**${text}**` : text,
      };
    default:
      return { kind: "text" as const, markdown: text };
  }
}

/** Prose items as markdown: separators only survive between two text items. */
function proseItemsToMarkdown(items: (ProseItem | null)[]) {
  const blocks: string[] = [];
  let pendingDivider = false;
  for (const item of items) {
    if (item?.kind === "text") {
      if (pendingDivider && blocks.length > 0) blocks.push("---");
      pendingDivider = false;
      blocks.push(item.markdown);
    } else if (item?.kind === "divider") {
      pendingDivider = true;
    }
  }
  return blocks.join("\n\n");
}

/** Column, column-direction Box, or an informational Card (section/unset variant). */
function isVerticalStack(
  c: Record<string, unknown>,
  interactiveCards: Set<string>,
) {
  // A container with an accessibility envelope keeps its children: lifted
  // text would lose its hidden state or its live region.
  if (c.accessibility !== undefined) return false;
  if (c.component === "Column") return true;
  if (c.component === "Box") {
    return c.direction == null || c.direction === "col";
  }
  if (c.component === "Card") {
    return (
      (c.variant == null || c.variant === "section") &&
      typeof c.id === "string" &&
      !interactiveCards.has(c.id)
    );
  }
  return false;
}

/** The child-id list of a stack (`children`, or a lone `child`), else null. */
/**
 * The children of a stack in render order: `child` first (a Card renders
 * its `child` before its `children`), then `children`.
 */
function stackChildren(c: Record<string, unknown>) {
  const first = typeof c.child === "string" ? [c.child] : [];
  if (Array.isArray(c.children)) return [...first, ...c.children];
  if (first.length > 0 && c.children === undefined) return first;
  return null;
}

/** A contiguous slice `[start, end)` of the stack's children. */
type ChildRun = { prose: boolean; start: number; end: number };

/**
 * Partitions the stack's children into alternating prose and surface runs.
 * A run of consecutive prose items is prose only when it holds text: a run of
 * separators alone (Divider/Spacer between two UI components, or at the very
 * start/end of the stack) stays with the surface it sits in.
 */
function partitionChildren(items: (ProseItem | null)[]) {
  const runs: ChildRun[] = [];
  let i = 0;
  while (i < items.length) {
    const candidate = items[i] !== null;
    let hasText = false;
    let j = i;
    while (j < items.length && (items[j] !== null) === candidate) {
      if (items[j]?.kind === "text") hasText = true;
      j++;
    }
    const prose = candidate && hasText;
    const last = runs[runs.length - 1];
    if (!prose && last && !last.prose) last.end = j;
    else runs.push({ prose, start: i, end: j });
    i = j;
  }
  return runs;
}

/** One block of a segmented surface, in render order. */
export type SurfaceSegment =
  | { kind: "markdown"; markdown: string }
  | { kind: "surface"; components: Record<string, unknown>[] };

/**
 * Markdown mode: split a surface into markdown and surface segments so that
 * only real UI renders as A2UI and everything else is the chat's markdown.
 *
 * From `root`, descend through single-child vertical containers (Column,
 * column Box, informational Card) to the first one with several children:
 * the stack. Its children are partitioned, in order, into runs of prose and
 * runs of UI. Prose is `Title`, `Text`, `Caption`, `Markdown` with literal
 * text, a `List` of literal text items, plus `Divider`/`Spacer` next to them:
 * `Title` → heading by size (sm `####`, md/lg `###`, larger `##`), `Text` →
 * paragraph (`strong` → `**…**`), `Caption`/`Markdown` → paragraph, `List` →
 * `- …` (or `1. …` for `marker: "number"`, `**label** — description` for
 * described items), and a `Divider` between two prose blocks → `---`.
 *
 * Not prose: `{path}`-bound text or items, a Text with inline children, a
 * List with `children`/icons/actions, a template entry, a component with an
 * `accessibility` envelope, and a child whose component has not streamed
 * yet. Separators with no text beside them stay in
 * the surface. An interactive Card (see `classifySurfaceCards`) is never
 * entered.
 *
 * Each prose run becomes a markdown segment; each UI run becomes a surface
 * segment whose `root` is a copy of the stack (its other props kept, `child`
 * dropped) with only that run's `children`, followed by every component
 * reachable from them. When nothing is prose the input comes back as the one
 * surface segment (same array); when everything is (or `root` itself is),
 * there are only markdown segments.
 *
 * Pure and linear in the number of components, so it runs on every stream
 * update.
 *
 * @param components - The components of one surface, root included.
 * @returns The segments in render order.
 *
 * @example
 * ```ts
 * for (const segment of segmentSurfaceProse(components)) {
 *   if (segment.kind === "markdown") renderMarkdown(segment.markdown);
 *   else renderSurface(segment.components);
 * }
 * ```
 */
export function segmentSurfaceProse(
  components: Record<string, unknown>[],
  options: ChildWalkOptions = {},
) {
  const unchanged: SurfaceSegment[] = [{ kind: "surface", components }];
  const byId = new Map<string, Record<string, unknown>>();
  for (const c of components) {
    if (isRecord(c) && typeof c.id === "string") byId.set(c.id, c);
  }
  const root = byId.get(GENERATIVE_UI_ROOT_ID);
  if (!root) return unchanged;
  // A component whose children are known only at render time (a bound
  // list of tabs) could reference any component. The lift cannot tell
  // which ones to keep, so it keeps the surface whole.
  const hasUnknownChildren = components.some(
    (c) => isRecord(c) && options.childIds?.(c) === "unknown",
  );
  if (hasUnknownChildren) return unchanged;

  const rootItem = toProseItem(root);
  if (rootItem?.kind === "text") {
    const whole: SurfaceSegment[] = [
      { kind: "markdown", markdown: rootItem.markdown },
    ];
    return whole;
  }

  const interactiveCards = classifySurfaceCards(components, options);
  let stack = root;
  let stackId: string = GENERATIVE_UI_ROOT_ID;
  let children: unknown[];
  const visited = new Set<string>();
  while (true) {
    if (!isVerticalStack(stack, interactiveCards)) return unchanged;
    visited.add(stackId);
    const list = stackChildren(stack);
    if (!list) return unchanged;
    children = list;
    const nextId = list.length === 1 ? list[0] : undefined;
    if (typeof nextId !== "string") break;
    const next = byId.get(nextId);
    if (!next || visited.has(nextId) || toProseItem(next)) break;
    stack = next;
    stackId = nextId;
  }

  const stackChildIds = children;
  const items = stackChildIds.map((id) =>
    typeof id === "string" ? toProseItem(byId.get(id)) : null,
  );
  const runs = partitionChildren(items);
  if (!runs.some((run) => run.prose)) return unchanged;

  // Which surface segments each component belongs to (shared ones go to all).
  const surfaceRuns = runs.filter((run) => !run.prose);
  const owners = new Map<string, number[]>();
  surfaceRuns.forEach((run, index) => {
    const pending = stackChildIds
      .slice(run.start, run.end)
      .map(referencedId)
      .filter((id): id is string => id !== undefined);
    const seen = new Set<string>();
    while (pending.length > 0) {
      const id = pending.pop()!;
      // `root` is replaced by the stack copy; the stack never nests in itself.
      const isSkipped = id === GENERATIVE_UI_ROOT_ID || id === stackId;
      if (isSkipped || seen.has(id)) continue;
      seen.add(id);
      const list = owners.get(id);
      if (list) list.push(index);
      else owners.set(id, [index]);
      const c = byId.get(id);
      if (c) pending.push(...directChildIds(c, options.childIds));
    }
  });
  const surfaceComponents = surfaceRuns.map((run) => {
    // `child` is folded into `children` by stackChildren, so the copy must
    // not render it a second time.
    const { child: _child, ...stackRest } = stack;
    const nextRoot: Record<string, unknown> = {
      ...stackRest,
      id: GENERATIVE_UI_ROOT_ID,
      children: stackChildIds.slice(run.start, run.end),
    };
    delete nextRoot.child;
    return [nextRoot];
  });
  for (const c of components) {
    if (!isRecord(c) || typeof c.id !== "string" || byId.get(c.id) !== c) {
      continue;
    }
    const ownerIndexes = owners.get(c.id) ?? [];
    for (const index of ownerIndexes) {
      surfaceComponents[index]!.push(c);
    }
  }

  let surfaceIndex = 0;
  const segments: SurfaceSegment[] = runs.map((run) => {
    if (run.prose) {
      return {
        kind: "markdown",
        markdown: proseItemsToMarkdown(items.slice(run.start, run.end)),
      };
    }
    return { kind: "surface", components: surfaceComponents[surfaceIndex++]! };
  });
  return segments;
}
