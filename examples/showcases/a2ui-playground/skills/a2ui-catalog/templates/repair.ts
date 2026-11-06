/**
 * Server-side repair for composed components.
 *
 * The browser checks every A2UI 1.0 operation against its catalog and drops
 * one that names an unknown prop or holds a value of the wrong type. Small
 * models drift in predictable ways (a number where an enum string is
 * expected, "3" for a number, `title` for `text`, an old-style binding
 * with a bare "path" key). We repair each component as it streams, so the
 * client gets operations it accepts:
 *
 * - the app's own components against their Zod schemas;
 * - the standard components against the JSON Schema the browser sent;
 * - every component against the browser's validator (`validateOperation`).
 *
 * `{ "@path" }` and `{ "@call" }` values are resolved in the browser, so
 * they are never "wrong type" here.
 */
import {
  A2UI_COMPONENT_ENVELOPE_KEYS,
  A2UI_VERSION,
  validateOperation,
  type GenerativeUIManifest,
} from "@copilotkit/shared";
import type { z } from "zod";
import { definitions } from "@/a2ui/catalog/definitions"; // your React-free definitions index

type Comp = Record<string, unknown> & { id: string; component: string };

const ALIASES: Record<string, string[]> = {
  text: ["title", "content", "label", "value", "body", "markdown"],
  title: ["text", "label", "heading", "name"],
  label: ["title", "text", "name"],
  value: ["text", "amount", "number"],
  name: ["title", "label"],
  url: ["src", "href", "image"],
  code: ["text", "content"],
  data: ["rows", "items", "points", "series"],
  rows: ["data", "items"],
  items: ["data", "rows", "events", "steps"],
  markers: ["places", "points", "locations"],
  places: ["markers", "points", "locations"],
};

const STRUCTURAL = new Set([
  "id",
  "component",
  ...A2UI_COMPONENT_ENVELOPE_KEYS,
]);

/** Old-style bindings (an object whose only key is "path"), at any depth, become `{ "@path" }`. */
function upgradeBindings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(upgradeBindings);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    entries.length === 1 &&
    entries[0][0] === "path" &&
    typeof entries[0][1] === "string"
  )
    return { "@path": entries[0][1] };
  return Object.fromEntries(entries.map(([k, v]) => [k, upgradeBindings(v)]));
}

/** A value the browser resolves: a data binding or a function call. */
const isDynamic = (v: unknown) =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  ("@path" in v || "@call" in v);

/** Coerces a top-level literal to a standard component's JSON Schema type. */
function coerceToSchema(
  value: unknown,
  schema: Record<string, unknown> | undefined,
): { ok: boolean; value?: unknown } {
  if (!schema || isDynamic(value)) return { ok: true, value };
  const options = (schema.anyOf ?? schema.oneOf) as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(options)) {
    for (const o of options) {
      const r = coerceToSchema(value, o);
      if (r.ok && r.value === value) return r;
    }
    for (const o of options) {
      const r = coerceToSchema(value, o);
      if (r.ok) return r;
    }
    return { ok: false };
  }
  if (Array.isArray(schema.enum)) {
    if (schema.enum.includes(value)) return { ok: true, value };
    const hit = schema.enum.find(
      (e) =>
        typeof e === "string" &&
        String(value).toLowerCase() === e.toLowerCase(),
    );
    return hit !== undefined ? { ok: true, value: hit } : { ok: false };
  }
  switch (schema.type) {
    case "string":
      return typeof value === "string"
        ? { ok: true, value }
        : typeof value === "number" || typeof value === "boolean"
          ? { ok: true, value: String(value) }
          : { ok: false };
    case "number":
    case "integer": {
      if (typeof value === "number") return { ok: true, value };
      const n =
        typeof value === "string" && value.trim() !== ""
          ? Number(value.replace(/[,%$]/g, ""))
          : NaN;
      return Number.isNaN(n) ? { ok: false } : { ok: true, value: n };
    }
    case "boolean":
      return typeof value === "boolean"
        ? { ok: true, value }
        : value === "true" || value === "false"
          ? { ok: true, value: value === "true" }
          : { ok: false };
    case "array":
      return Array.isArray(value) ? { ok: true, value } : { ok: false };
    case "object":
      return value && typeof value === "object" && !Array.isArray(value)
        ? { ok: true, value }
        : { ok: false };
    default:
      return { ok: true, value };
  }
}

function coerce(
  value: unknown,
  issue: z.ZodIssue,
): { ok: boolean; value?: unknown } {
  if (issue.code === "invalid_type") {
    if (typeof value === "number" && String(issue.expected).includes("'"))
      return { ok: true, value: String(value) };
    if (
      issue.expected === "string" &&
      (typeof value === "number" || typeof value === "boolean")
    )
      return { ok: true, value: String(value) };
    if (
      issue.expected === "number" &&
      typeof value === "string" &&
      value.trim() !== "" &&
      !Number.isNaN(Number(value.replace(/[,%$]/g, "")))
    )
      return { ok: true, value: Number(value.replace(/[,%$]/g, "")) };
    if (issue.expected === "boolean" && (value === "true" || value === "false"))
      return { ok: true, value: value === "true" };
    if (issue.expected === "array" && typeof value === "string")
      return { ok: true, value: [value] };
  }
  // `{ nodes: [...], links: [...] }` where an array was expected: unwrap the array (prefer the prop's own name).
  if (
    (issue.code === "invalid_union" ||
      (issue.code === "invalid_type" && issue.expected === "array")) &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !("path" in value)
  ) {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => Array.isArray(v),
    );
    const own = entries.find(
      ([k]) => k === String(issue.path[issue.path.length - 1]),
    );
    const pick = own ?? entries[0];
    if (pick) return { ok: true, value: pick[1] };
  }
  if (issue.code === "invalid_enum_value" || issue.code === "invalid_union") {
    if (typeof value === "number") return { ok: true, value: String(value) };
    if (typeof value === "string") {
      const opts = (issue as { options?: unknown[] }).options;
      const hit = opts?.find(
        (o) => typeof o === "string" && o.toLowerCase() === value.toLowerCase(),
      );
      if (hit) return { ok: true, value: hit };
    }
  }
  return { ok: false };
}

/** Union errors (e.g. `z.union([z.string(), z.number()])`) hide the real issue: descend into the most specific branch. */
function flatten(issues: z.ZodIssue[]): z.ZodIssue[] {
  const out: z.ZodIssue[] = [];
  for (const issue of issues) {
    if (issue.code === "invalid_union" && issue.unionErrors?.length) {
      const branches = issue.unionErrors
        .map((e) => flatten(e.issues))
        .filter((b) => !b.every((i) => i.path[i.path.length - 1] === "path"));
      const best = branches.sort(
        (a, b) =>
          Math.max(0, ...b.map((i) => i.path.length)) -
          Math.max(0, ...a.map((i) => i.path.length)),
      )[0];
      if (best?.length && best.some((i) => i.path.length > issue.path.length)) {
        out.push(...best);
        continue;
      }
    }
    out.push(issue);
  }
  return out;
}

function setPath(
  obj: Record<string, unknown>,
  path: (string | number)[],
  value: unknown,
) {
  let cur: any = obj;
  for (let i = 0; i < path.length - 1; i++) cur = cur?.[path[i]];
  if (cur && typeof cur === "object") cur[path[path.length - 1]] = value;
}
function getPath(obj: Record<string, unknown>, path: (string | number)[]) {
  return path.reduce<any>((cur, k) => cur?.[k], obj);
}

export type RepairNote = {
  id: string;
  component: string;
  fixed: string[];
  failed: string[];
};

type OwnDef = {
  props: z.ZodObject<z.ZodRawShape>;
  events?: Record<string, unknown>;
};

/**
 * Repairs one component. Without a manifest only the app's own
 * components are checked (their Zod schemas live on the server too).
 */
export function repairComponent(
  c: Comp,
  manifest?: GenerativeUIManifest,
): { component: Comp; note?: RepairNote } {
  const def = (definitions as Record<string, OwnDef>)[c.component];
  const entry = manifest?.components[c.component];
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c))
    if (!STRUCTURAL.has(k)) props[k] = upgradeBindings(v);
  const fixed: string[] = [];
  const failed: string[] = [];
  // Old habit: a card's `action` prop is the `onAction` event in A2UI 1.0.
  if (
    "action" in props &&
    !("onAction" in props) &&
    (def?.events?.onAction || entry?.events?.onAction)
  ) {
    props.onAction = props.action;
    delete props.action;
    fixed.push("action->onAction");
  }
  if (entry) {
    const known = new Set([
      ...Object.keys((entry.props.properties ?? {}) as object),
      ...Object.keys(entry.events ?? {}),
      ...Object.keys(entry.slots ?? {}),
    ]);
    const required = new Set(
      Array.isArray(entry.props.required)
        ? (entry.props.required as string[])
        : [],
    );
    for (const name of required) {
      if (name in props) continue;
      const alias = (ALIASES[name] ?? []).find(
        (a) => a in props && !known.has(a),
      );
      if (alias) {
        props[name] = props[alias];
        delete props[alias];
        fixed.push(`${alias}->${name}`);
      }
    }
    for (const key of Object.keys(props)) {
      if (known.has(key)) continue;
      delete props[key];
      fixed.push(`-${key}`);
    }
    if (!def) {
      // A standard component: its props are JSON Schema. Coerce top-level literals, drop optional ones that cannot fit.
      const schemas = (entry.props.properties ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const [key, value] of Object.entries(props)) {
        if (!(key in schemas)) continue;
        const r = coerceToSchema(value, schemas[key]);
        if (r.ok) {
          if (r.value !== value) {
            props[key] = r.value;
            fixed.push(key);
          }
        } else if (!required.has(key)) {
          delete props[key];
          fixed.push(`-${key}`);
        } else failed.push(`${key}: wrong type`);
      }
    }
  }
  if (!def) return finish(c, props, fixed, failed, manifest);
  // Missing required prop but an obvious synonym present (e.g. Heading { title } instead of { text }).
  for (const [key, schema] of Object.entries(
    def.props.shape as Record<string, z.ZodTypeAny>,
  )) {
    if (key in props || schema.isOptional() || entry) continue;
    const alias = (ALIASES[key] ?? []).find(
      (a) => a in props && !(a in def.props.shape),
    );
    if (alias) {
      props[key] = props[alias];
      delete props[alias];
      fixed.push(`${alias}->${key}`);
    }
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = def.props.safeParse(props);
    if (r.success) break;
    let changed = false;
    for (const issue of flatten(r.error.issues)) {
      const path = issue.path;
      if (!path.length) continue;
      // A binding or function call anywhere on the path is resolved in the browser.
      if (path.some((_, i) => isDynamic(getPath(props, path.slice(0, i + 1)))))
        continue;
      const top = String(path[0]);
      const val = getPath(props, path);
      const co = coerce(val, issue);
      if (co.ok) {
        setPath(props, path, co.value);
        fixed.push(`${path.join(".")}`);
        changed = true;
        continue;
      }
      // An invalid optional top-level prop is dropped rather than failing the whole component.
      const shape = def.props.shape[top] as z.ZodTypeAny | undefined;
      if (shape && shape.isOptional() && top in props) {
        delete props[top];
        fixed.push(`-${top}`);
        changed = true;
        continue;
      }
      // Array of objects with a bad element: drop that element.
      if (
        path.length >= 2 &&
        typeof path[1] === "number" &&
        Array.isArray(props[top])
      ) {
        (props[top] as unknown[]).splice(path[1] as number, 1);
        fixed.push(`-${top}[${path[1]}]`);
        changed = true;
        break;
      }
      failed.push(`${path.join(".")}: ${issue.message}`);
    }
    if (!changed) break;
  }
  return finish(c, props, fixed, failed, manifest);
}

function finish(
  c: Comp,
  props: Record<string, unknown>,
  fixed: string[],
  failed: string[],
  manifest?: GenerativeUIManifest,
) {
  const out = { id: c.id, component: c.component, ...props } as Comp;
  for (const k of STRUCTURAL)
    if (k in c && !(k in out)) (out as Record<string, unknown>)[k] = c[k];
  if (manifest) {
    // The same check the browser runs before it applies the operation.
    const surfaceId = "check";
    const v = validateOperation(
      {
        version: A2UI_VERSION,
        updateComponents: { surfaceId, components: [out] },
      },
      {
        manifest,
        knownSurfaces: new Set([surfaceId]),
        createdSurfaces: new Set([surfaceId]),
        functions: manifest.functions,
      },
    );
    if (!v.ok) failed.push(v.reason);
  }
  return {
    component: out,
    note:
      fixed.length || failed.length
        ? { id: c.id, component: c.component, fixed, failed }
        : undefined,
  };
}

/** House style: no em/en dashes and no emoji in generated copy. " \u2014 " becomes ", ", a bare dash becomes "-". */
export function stripDashes<T>(value: T): T {
  if (typeof value === "string")
    return value
      .replace(/\s*\u2014\s*/g, ", ")
      .replace(/\u2013/g, "-")
      .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "")
      .replace(/\s{2,}/g, " ") as T;
  if (Array.isArray(value)) return value.map(stripDashes) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, stripDashes(v)]),
    ) as T;
  return value;
}
