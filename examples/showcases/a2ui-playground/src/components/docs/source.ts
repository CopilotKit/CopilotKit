import fs from "node:fs";
import path from "node:path";
import { A2UI_CHILD_LIST_MARK, A2UI_COMPONENT_ID_MARK } from "@copilotkit/shared";
import { z } from "zod";
import { definitions, type ComponentName } from "@/a2ui/catalog/definitions";
import type { PropRow } from "./props-table";

const ROOT = process.cwd();
const DEF_DIR = "src/a2ui/catalog/definitions";
const REN_DIR = "src/a2ui/catalog/renderers";
const TEMPLATES = "src/agent/surfaces/templates.ts";

function read(rel: string): string | null {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

function list(dir: string, ext: RegExp): string[] {
  try {
    return fs.readdirSync(path.join(ROOT, dir)).filter((f) => ext.test(f)).map((f) => `${dir}/${f}`);
  } catch {
    return [];
  }
}

/**
 * Slice one entry of an object literal written as `  Name: ...` at two-space
 * indent: from its first line up to the next sibling entry or the closing `};`.
 * Comment lines that belong to the next entry are trimmed off the end.
 */
function sliceEntry(src: string, start: RegExp): string | null {
  const lines = src.split("\n");
  const i = lines.findIndex((l) => start.test(l));
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && !/^ {2}[A-Z][A-Za-z0-9]*:\s/.test(lines[j]) && !/^}/.test(lines[j])) j++;
  let end = j;
  while (end > i + 1) {
    const t = lines[end - 1].trim();
    if (t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) end--;
    else break;
  }
  return lines
    .slice(i, end)
    .map((l) => l.replace(/^ {2}/, ""))
    .join("\n")
    .replace(/,\s*$/, "");
}

export type SourceSlice = { file: string; code: string | null };

/** Top-level `const x = ...;` helpers in a file (single statement, possibly multi-line). */
function localConsts(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:export )?const ([a-z][A-Za-z0-9]*) =/);
    if (!m) continue;
    let j = i;
    while (j < lines.length && !/;\s*$/.test(lines[j])) j++;
    out.set(m[1], lines.slice(i, j + 1).join("\n").replace(/^export /, ""));
  }
  return out;
}

/** The entry plus the file-local helper consts it references (transitively), pretty-printed. */
export function definitionSource(name: ComponentName): SourceSlice {
  const re = new RegExp(`^ {2}${name}:\\s*def\\(`);
  for (const file of list(DEF_DIR, /\.ts$/)) {
    const src = read(file);
    if (!src || !src.split("\n").some((l) => re.test(l))) continue;
    const entry = sliceEntry(src, re);
    if (!entry) return { file, code: null };
    const consts = localConsts(src);
    const used: string[] = [];
    const seen = new Set<string>();
    const visit = (code: string) => {
      for (const [id, stmt] of consts) {
        if (seen.has(id) || !new RegExp(`\\b${id}\\b`).test(code)) continue;
        seen.add(id);
        visit(stmt.replace(/^const \w+ =/, ""));
        used.push(id);
      }
    };
    visit(entry);
    const helpers = used.map((id) => pretty(consts.get(id)!)).join("\n");
    return { file, code: (helpers ? `${helpers}\n\n` : "") + pretty(entry) };
  }
  return { file: DEF_DIR, code: null };
}

export function rendererSource(name: ComponentName): SourceSlice {
  const re = new RegExp(`^ {2}${name}:\\s*\\(`);
  for (const file of list(REN_DIR, /\.tsx$/)) {
    const src = read(file);
    if (!src || !src.split("\n").some((l) => re.test(l))) continue;
    return { file, code: sliceEntry(src, re) };
  }
  const cat = definitions[name].category.toLowerCase().replace(" display", "").replace(" ", "-");
  return { file: `${REN_DIR}/${cat}.tsx`, code: null };
}

/* ---------- templates ---------- */

const TEMPLATE_LABEL: Record<string, string> = {
  WEATHER: "Weather",
  PLACES: "Places",
  ROUTE: "Route",
  FX: "Currency (FX)",
  STOCK: "Stock",
  FLIGHTS: "Flights",
  PROFILE: "Profile",
  RECEIPT: "Receipt",
  EVENT: "Event",
  SIGNUP: "Signup",
  RECIPE_TEMPLATE: "Recipe",
};

let templateCache: Array<{ id: string; label: string; components: Set<string> }> | null = null;

function templates() {
  if (templateCache) return templateCache;
  const src = read(TEMPLATES) ?? "";
  const parts = src.split(/^export const /m).slice(1);
  templateCache = parts
    .map((chunk) => {
      const id = chunk.match(/^([A-Z_]+)/)?.[1] ?? "";
      const components = new Set(Array.from(chunk.matchAll(/component:\s*"([A-Za-z]+)"/g)).map((m) => m[1]));
      return { id, label: TEMPLATE_LABEL[id] ?? id, components };
    })
    .filter((t) => t.id && TEMPLATE_LABEL[t.id] && t.components.size);
  return templateCache;
}

export function templatesUsing(name: string): string[] {
  return templates()
    .filter((t) => t.components.has(name))
    .map((t) => t.label);
}

/* ---------- props table ---------- */

export type { PropRow };

type Any = z.ZodTypeAny;

/** The A2UI 1.0 child-reference mark a `child()` / `childList()` prop carries in its description. */
function childMark(t: Any): "one" | "list" | null {
  const d = t.description ?? "";
  return d.startsWith(A2UI_COMPONENT_ID_MARK) ? "one" : d.startsWith(A2UI_CHILD_LIST_MARK) ? "list" : null;
}

function unwrap(t: Any): { inner: Any; optional: boolean; description: string | null } {
  let cur = t;
  let optional = false;
  let description: string | null = t.description ?? null;
  while (["ZodOptional", "ZodDefault", "ZodNullable", "ZodEffects"].includes(cur._def.typeName)) {
    if (cur._def.typeName !== "ZodEffects") optional = true;
    cur = cur._def.typeName === "ZodEffects" ? cur._def.schema : cur._def.innerType;
    description = description ?? cur.description ?? null;
  }
  const mark = childMark(cur);
  if (mark) description = mark === "one" ? "Id of one child component." : "Ids of child components, or a template { componentId, path } over a data list.";
  return { inner: cur, optional, description };
}

function typeOf(t: Any, depth = 0): string {
  const { inner } = unwrap(t);
  const mark = childMark(inner);
  if (mark) return mark === "one" ? "component id" : "string[] | { componentId, path }";
  const base = (() => {
    switch (inner._def.typeName) {
      case "ZodString":
        return "string";
      case "ZodNumber":
        return "number";
      case "ZodBoolean":
        return "boolean";
      case "ZodAny":
      case "ZodUnknown":
        return "any";
      case "ZodLiteral":
        return JSON.stringify(inner._def.value);
      case "ZodEnum": {
        const v = inner._def.values as string[];
        return v.length > 6 ? `${v.slice(0, 6).map((x) => `"${x}"`).join(" | ")} | ...` : v.map((x) => `"${x}"`).join(" | ");
      }
      case "ZodArray": {
        const el = typeOf(inner._def.type, depth + 1);
        return el.includes("|") ? `(${el})[]` : `${el}[]`;
      }
      case "ZodRecord":
        return "Record<string, any>";
      case "ZodObject": {
        const shape = inner._def.shape() as Record<string, Any>;
        const keys = Object.entries(shape).map(([k, v]) => `${k}${unwrap(v).optional ? "?" : ""}`);
        if (depth > 2) return "object";
        return `{ ${keys.join(", ")} }`;
      }
      case "ZodUnion": {
        const opts = inner._def.options as Any[];
        if (opts.some((o) => o._def.typeName === "ZodObject" && "event" in o._def.shape())) return "Action";
        if (opts.some((o) => o._def.typeName === "ZodObject" && "componentId" in o._def.shape())) return "string[] | { componentId, path }";
        return opts.map((o) => typeOf(o, depth + 1)).join(" | ");
      }
      default:
        return "any";
    }
  })();
  return base;
}

export function propRows(name: ComponentName): PropRow[] {
  const def = definitions[name] as { props: z.ZodObject<z.ZodRawShape>; events?: Record<string, { description?: string }> };
  const shape = def.props.shape as Record<string, Any>;
  const props = Object.entries(shape).map(([k, v]) => {
    const { optional, description } = unwrap(v);
    return { name: k, type: typeOf(v), required: !optional, description };
  });
  const events = Object.entries(def.events ?? {}).map(([k, e]) => ({ name: k, type: "Action (event or functionCall)", required: false, description: e.description ?? null }));
  return [...props, ...events];
}

/* ---------- tiny pretty-printer for one-line definitions ---------- */

/**
 * Breaks any (), {} or [] group whose one-line form would push the line past
 * `width` into one item per line, recursively. Strings are respected. Good
 * enough for the catalog's def(...) one-liners; not a general formatter.
 */
export function pretty(code: string, width = 84): string {
  if (code.split("\n").every((l) => l.length <= width)) return code;
  if (code.includes("\n")) return code
    .split("\n")
    .map((l) => (l.length > width ? prettyLine(l, width) : l))
    .join("\n");
  return prettyLine(code, width);
}

type Node = string | { open: string; close: string; items: Node[][] };

function parseGroup(src: string, i: number, close: string): { items: Node[][]; end: number } {
  const items: Node[][] = [[]];
  let buf = "";
  const flush = () => {
    if (buf) items[items.length - 1].push(buf);
    buf = "";
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      buf += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") {
      flush();
      const cl = c === "(" ? ")" : c === "{" ? "}" : "]";
      const g = parseGroup(src, i + 1, cl);
      items[items.length - 1].push({ open: c, close: cl, items: g.items });
      i = g.end + 1;
      continue;
    }
    if (c === close) {
      flush();
      return { items, end: i };
    }
    if (c === ",") {
      flush();
      items.push([]);
      i++;
      while (src[i] === " ") i++;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return { items, end: i };
}

function flat(n: Node[]): string {
  return n.map((x) => (typeof x === "string" ? x : `${x.open}${x.items.map(flat).join(", ")}${x.close}`)).join("");
}

function render(n: Node[], indent: string, width: number): string {
  let out = "";
  for (const x of n) {
    if (typeof x === "string") {
      out += x;
      continue;
    }
    const one = `${x.open}${x.items.map(flat).join(", ")}${x.close}`;
    const col = (out.split("\n").pop() ?? "").length + indent.length;
    const items = x.items.filter((it) => it.length);
    if (col + one.length <= width || items.length === 0) {
      out += one;
      continue;
    }
    // Hug a lone argument that ends in a group: dyn(z.array(z.object({ ... })))
    const solo = items.length === 1 ? items[0].filter((y) => typeof y !== "string" || y.trim()) : [];
    const groups = solo.filter((y) => typeof y !== "string");
    if (groups.length === 1 && solo[solo.length - 1] === groups[0]) {
      out += x.open + render(solo, indent, width) + x.close;
      continue;
    }
    const inner = indent + "  ";
    out += x.open + "\n" + items.map((it) => inner + render(it, inner, width).trim()).join(",\n") + ",\n" + indent + x.close;
  }
  return out;
}

function prettyLine(line: string, width: number): string {
  const lead = line.match(/^\s*/)?.[0] ?? "";
  const { items } = parseGroup(line.trim(), 0, "\u0000");
  return lead + items.map((it) => render(it, lead, width)).join(", ");
}
