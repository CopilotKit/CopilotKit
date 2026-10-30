/**
 * Checks hand-edited A2UI v1.0 operations the way the renderer will:
 * JSON syntax first, then `validateOperation` from `@copilotkit/shared`
 * against the catalog manifest (the same call CopilotKit's surface manager
 * makes), then the prop types the manager checks before it applies a
 * component. Every problem carries an offset into the text so the editor
 * can jump to it.
 */
import {
  A2UI_COMPONENT_ENVELOPE_KEYS,
  GENERATIVE_UI_ROOT_ID,
  getOperationKind,
  getOperationSurfaceId,
  isActionBinding,
  isCallBinding,
  isPathBinding,
  validateOperation,
  type ValidateOperationOptions,
} from "@copilotkit/shared";
import type { GenerativeUI } from "@copilotkit/react-core/v2/generative-ui";
import { latestComponents, surfaceIdOf, type A2UIOp } from "@/lib/run-store";

export type Problem = {
  severity: "error" | "warning";
  /** "JSON" for a syntax error, else the 1-based operation number. */
  where: "json" | "surface" | number;
  opKind?: string;
  componentId?: string;
  message: string;
  /** Offset in the text to jump to. */
  offset?: number;
};

export type Analysis = {
  /** The operations, when nothing blocks rendering. */
  ops: A2UIOp[] | null;
  /** `JSON.stringify(ops)`, to tell a real change from a whitespace edit. */
  fingerprint: string | null;
  problems: Problem[];
  opCount: number;
  componentCount: number;
  surfaceId: string | null;
};

type Manifest = ValidateOperationOptions["manifest"];

/** What `validateOperation` needs from a generative UI: its id, the ids of its bases, and the model-facing components. */
export function manifestOf(ui: GenerativeUI, baseIds: string[]): Manifest {
  return { catalogId: ui.id, catalogIds: [...new Set([ui.id, ...baseIds])], components: ui.manifestComponents };
}

export function analyzeOps(text: string, ui: GenerativeUI, manifest: Manifest): Analysis {
  const empty = { ops: null, fingerprint: null, opCount: 0, componentCount: 0, surfaceId: null };
  if (!text.trim()) return { ...empty, problems: [{ severity: "error", where: "json", message: "The editor is empty. Paste an operation list or pick a starter.", offset: 0 }] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const found = jsonErrorAt(text);
    return { ...empty, problems: [found ? { severity: "error", where: "json", message: found.message, offset: found.offset } : { severity: "error", where: "json", message: String((e as Error).message) }] };
  }

  // A single operation object is accepted as a list of one.
  const single = !Array.isArray(parsed) && !!getOperationKind(parsed);
  if (!Array.isArray(parsed) && !single) {
    return { ...empty, problems: [{ severity: "error", where: "json", message: "Expected an array of A2UI operations: [{ \"version\": \"v1.0\", \"createSurface\": { ... } }, ...]", offset: 0 }] };
  }
  const ops = (single ? [parsed] : parsed) as A2UIOp[];
  // Only objects can be read for ids and components; the others are reported below.
  const records = ops.filter((op) => !!op && typeof op === "object" && !Array.isArray(op));
  const starts = single ? [Math.max(0, text.indexOf("{"))] : elementOffsets(text);
  const opRange = (i: number): [number, number] => [starts[i] ?? 0, starts[i + 1] ?? text.length];
  const problems: Problem[] = [];

  if (!ops.length) problems.push({ severity: "error", where: "json", message: "The list has no operations. Start with a createSurface.", offset: 0 });

  // Walk the list like the surface manager does: each operation sees the surfaces created before it.
  const surfaceId = records.length ? surfaceIdOf(records) : null;
  const known = new Set<string>();
  const created = new Set<string>();
  ops.forEach((op, i) => {
    const kind = getOperationKind(op);
    const [from, to] = opRange(i);
    const at = (componentId?: string) => (componentId ? (idOffset(text, componentId, from, to) ?? from) : from);
    const result = validateOperation(op, { manifest, knownSurfaces: known, createdSurfaces: created });
    if (!result.ok) {
      const { componentId, message } = splitReason(result.reason);
      problems.push({ severity: "error", where: i + 1, opKind: kind, componentId, message, offset: at(componentId) });
      return;
    }
    const target = getOperationSurfaceId(op);
    if (target && surfaceId && target !== surfaceId) {
      problems.push({ severity: "error", where: i + 1, opKind: kind, message: `this operation is for surface "${target}"; the preview shows one surface, "${surfaceId}"`, offset: from });
      return;
    }
    if (kind === "createSurface" && target) {
      known.add(target);
      created.add(target);
    }
    if (kind === "deleteSurface" && target) known.delete(target);
    for (const node of componentsOf(op)) {
      const reason = propTypeProblem(ui, node);
      if (reason) problems.push({ severity: "error", where: i + 1, opKind: kind, componentId: node.id, message: reason, offset: at(node.id) });
    }
  });

  const blocking = problems.some((p) => p.severity === "error");
  const comps = blocking ? [] : latestComponents(ops);
  if (!blocking) {
    const ids = new Set(comps.map((c) => c.id));
    if (comps.length && !ids.has(GENERATIVE_UI_ROOT_ID)) {
      problems.push({ severity: "error", where: "surface", message: `no component has the id "${GENERATIVE_UI_ROOT_ID}", so nothing renders`, offset: 0 });
    }
    // Dangling child ids still render (as nothing), so they warn instead of blocking.
    for (const c of comps) {
      const slots = ui.manifestComponents[String(c.component)]?.slots ?? {};
      for (const slot of Object.keys(slots)) {
        const refs = Array.isArray(c[slot]) ? (c[slot] as unknown[]) : typeof c[slot] === "string" ? [c[slot]] : [];
        for (const ref of refs) {
          if (typeof ref === "string" && !ids.has(ref)) {
            const i = lastOpWith(ops, c.id);
            const [from, to] = opRange(i);
            problems.push({ severity: "warning", where: i + 1, opKind: getOperationKind(ops[i]), componentId: c.id, message: `${slot} lists "${ref}", but no component has that id`, offset: idOffset(text, c.id, from, to) ?? from });
          }
        }
      }
    }
  }

  const ok = !problems.some((p) => p.severity === "error");
  return {
    ops: ok ? ops : null,
    fingerprint: ok ? JSON.stringify(ops) : null,
    problems,
    opCount: ops.length,
    componentCount: ok ? comps.length : latestComponents(records).length,
    surfaceId,
  };
}

/** `component "kpi-1": unknown prop "foo"` → the id and the rest. */
function splitReason(reason: string): { componentId?: string; message: string } {
  const m = /^component "([^"]+)": ([\s\S]*)$/.exec(reason);
  return m ? { componentId: m[1], message: m[2] } : { message: reason };
}

type Node = { id: string; component: string } & Record<string, unknown>;

function componentsOf(op: A2UIOp): Node[] {
  const list = (op.createSurface as { components?: unknown } | undefined)?.components ?? (op.updateComponents as { components?: unknown } | undefined)?.components;
  return Array.isArray(list) ? (list as Node[]) : [];
}

function lastOpWith(ops: A2UIOp[], id: string) {
  for (let i = ops.length - 1; i >= 0; i--) if (componentsOf(ops[i]).some((n) => n.id === id)) return i;
  return 0;
}

/** Holds a `@path` or `@call` anywhere inside (an action binding is not a value). */
function isDynamic(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isDynamic);
  if (!value || typeof value !== "object") return false;
  if (isPathBinding(value) || isCallBinding(value)) return true;
  if (isActionBinding(value)) return false;
  return Object.values(value).some(isDynamic);
}

type Issue = { message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> };
const issueKey = (issue: Issue) => {
  const first = issue.path?.[0];
  const key = first && typeof first === "object" ? first.key : first;
  return key === undefined ? undefined : String(key);
};

/**
 * The prop-type check CopilotKit's surface manager runs before it applies a
 * component (it rejects the whole operation on a failure): the literal props
 * against the component's props schema. Bound props are left out, they are
 * only known at render time; a `null` is read as "not set".
 */
function propTypeProblem(ui: GenerativeUI, node: Node): string | undefined {
  const def = ui.components.get(node.component);
  const schema = def?.props;
  if (!def || !schema) return undefined;
  const unknownNow = new Set(Object.keys(def.selectors ?? {}));
  const literals: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "id" || key === "component" || def.events?.[key] || def.slots?.[key] || A2UI_COMPONENT_ENVELOPE_KEYS.has(key)) continue;
    if (isDynamic(value)) unknownNow.add(key);
    else if (value !== null) literals[key] = value;
  }
  const result = schema["~standard"].validate(literals);
  if (result instanceof Promise || !result.issues) return undefined;
  const issues = (result.issues as readonly Issue[]).filter((issue) => {
    const key = issueKey(issue);
    return key !== undefined && !unknownNow.has(key);
  });
  if (!issues.length) return undefined;
  return issues
    .slice(0, 2)
    .map((issue) => `${(issue.path ?? []).map((s) => String(s && typeof s === "object" ? s.key : s)).join(".")}: ${issue.message}`)
    .join("; ");
}

/** Offset of `"id": "<id>"` between `from` and `to`. */
function idOffset(text: string, id: string, from: number, to: number) {
  const re = new RegExp(`"id"\\s*:\\s*${JSON.stringify(id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
  re.lastIndex = from;
  const m = re.exec(text);
  return m && m.index < to ? m.index : undefined;
}

/** Start offsets of the items of a top-level JSON array (the text is valid JSON). */
function elementOffsets(text: string): number[] {
  const out: number[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let expecting = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (depth === 1 && expecting && c !== "," && c !== "]" && !/\s/.test(c)) {
      out.push(i);
      expecting = false;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") {
      depth++;
      if (depth === 1) expecting = true;
    } else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 1) expecting = true;
  }
  return out;
}

/**
 * Where strict JSON parsing fails, with a readable reason. Browsers word
 * `JSON.parse` errors differently and some leave out the position, so the
 * editor finds it itself.
 */
export function jsonErrorAt(text: string): { offset: number; message: string } | null {
  let i = 0;
  const n = text.length;
  class Fail {
    constructor(
      readonly offset: number,
      readonly message: string,
    ) {}
  }
  const fail = (message: string, at = i): never => {
    throw new Fail(at, message);
  };
  const ws = () => {
    while (i < n && (text[i] === " " || text[i] === "\n" || text[i] === "\t" || text[i] === "\r")) i++;
  };
  const found = () => (i >= n ? "the end of the text" : JSON.stringify(text[i]));
  const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

  const value = (): void => {
    ws();
    if (i >= n) fail("The JSON ends where a value should be. Is a closing bracket or brace missing?");
    const c = text[i];
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === '"') return string();
    if (c === "-" || (c >= "0" && c <= "9")) {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(text);
      if (!m) fail(`Invalid number`);
      i += m![0].length;
      return;
    }
    for (const lit of ["true", "false", "null"]) {
      if (text.startsWith(lit, i)) {
        i += lit.length;
        return;
      }
    }
    if (c === "'") fail("Strings need double quotes, not single quotes");
    fail(`Expected a value, found ${found()}`);
  };
  const object = () => {
    const open = i;
    i++;
    ws();
    if (text[i] === "}") return void i++;
    for (;;) {
      ws();
      if (i >= n) fail("Unclosed {: a closing } is missing", open);
      if (text[i] === "}") fail("Trailing comma: remove the , before }");
      if (text[i] !== '"') fail(`Expected a "quoted" property name, found ${found()}`);
      string();
      ws();
      if (text[i] !== ":") fail(`Expected : after the property name, found ${found()}`);
      i++;
      value();
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") return void i++;
      if (i >= n) fail("Unclosed {: a closing } is missing", open);
      fail(`Expected , or } after a property value, found ${found()}`);
    }
  };
  const array = () => {
    const open = i;
    i++;
    ws();
    if (text[i] === "]") return void i++;
    for (;;) {
      ws();
      if (i >= n) fail("Unclosed [: a closing ] is missing", open);
      if (text[i] === "]") fail("Trailing comma: remove the , before ]");
      value();
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") return void i++;
      if (i >= n) fail("Unclosed [: a closing ] is missing", open);
      fail(`Expected , or ] after an item, found ${found()}`);
    }
  };
  const string = () => {
    const open = i;
    i++;
    while (i < n) {
      const c = text[i];
      if (c === '"') return void i++;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "\n") fail("Unterminated string: the closing \" is missing", open);
      if (c < " ") fail("Control character inside a string");
      i++;
    }
    fail("Unterminated string: the closing \" is missing", open);
  };

  try {
    value();
    ws();
    if (i < n) fail(`Unexpected ${found()} after the end of the JSON`);
    return null;
  } catch (e) {
    if (e instanceof Fail) return { offset: e.offset, message: e.message };
    throw e;
  }
}

/** 1-based line and column of an offset. */
export function lineColOf(text: string, offset: number) {
  let line = 1;
  let last = -1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, col: end - last };
}
