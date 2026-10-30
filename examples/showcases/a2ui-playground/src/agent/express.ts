/**
 * A2UI Express with Google's `@a2ui/agent` SDK.
 *
 * Express is the compact, Python-like inference format the A2UI SDKs default
 * to: the model writes one statement per component (`kpi = Stat("Revenue",
 * "$4.2M")`), and the SDK compiles it, against the catalog, into standard
 * A2UI v1.0 messages. It needs no tool calling, so any LLM can write it.
 *
 * The SDK compiles a whole response. The grammar is line-oriented, so this
 * module also compiles a partial response: every complete statement so far,
 * with a `Blueprint` frame for each id they name that is not written yet.
 * That is how an Express surface paints while the model is still writing.
 */
import {
  A2uiGenerator,
  CatalogConfig,
  ExpressDecompiler,
  ExpressFormatFactory,
  InMemoryCatalogProvider,
  type A2uiRequestProcessor,
  type AgentToRendererMessage,
} from "@a2ui/agent";
import inference from "@/a2ui/export/inference-catalog.json";
import type { Node } from "./surface";

type Doc = typeof inference & { components: Record<string, unknown> };
const doc = inference as Doc;
const CAPS = { "v1.0": { supportedCatalogIds: [doc.catalogId] } };

/** The same catalog plus the Blueprint frame, for compiling partial responses only. */
const previewDoc = {
  ...doc,
  components: {
    ...doc.components,
    Blueprint: {
      type: "object",
      properties: { component: { const: "Blueprint" }, of: { type: "string" }, state: { type: "string" } },
      required: ["component"],
    },
  },
  $defs: { ...doc.$defs, anyComponent: { ...doc.$defs.anyComponent, oneOf: [...doc.$defs.anyComponent.oneOf, { $ref: "#/components/Blueprint" }] } },
};

let generators: { main: A2uiGenerator; preview: A2uiGenerator; decompiler: ExpressDecompiler } | undefined;
function sdk() {
  if (!generators) {
    const main = new CatalogConfig(new InMemoryCatalogProvider(doc as unknown as Record<string, unknown>).load());
    const preview = new CatalogConfig(new InMemoryCatalogProvider(previewDoc as unknown as Record<string, unknown>).load());
    generators = { main: new A2uiGenerator([main]), preview: new A2uiGenerator([preview]), decompiler: new ExpressDecompiler(main.catalog, "v1.0") };
  }
  return generators;
}

export const expressProcessor = (surfaceId: string): A2uiRequestProcessor => sdk().main.createProcessor(CAPS, new ExpressFormatFactory({ surfaceId }));
const previewProcessor = (surfaceId: string): A2uiRequestProcessor => sdk().preview.createProcessor(CAPS, new ExpressFormatFactory({ surfaceId }));

/** Components and data model after a list of compiled messages. */
export function surfaceOf(messages: AgentToRendererMessage[]): { components: Node[]; data: Record<string, unknown> } {
  const byId = new Map<string, Node>();
  let data: Record<string, unknown> = {};
  for (const m of messages as Array<Record<string, any>>) {
    for (const c of (m.createSurface?.components ?? m.updateComponents?.components ?? []) as Node[]) byId.set(c.id, c);
    if (m.createSurface?.dataModel) data = { ...data, ...m.createSurface.dataModel };
    const u = m.updateDataModel as { path?: string; value?: unknown } | undefined;
    if (u) {
      const segs = (u.path ?? "/").split("/").filter(Boolean);
      if (!segs.length) data = { ...data, ...(u.value as Record<string, unknown>) };
      else {
        let cur = data;
        for (const s of segs.slice(0, -1)) cur = (cur[s] = typeof cur[s] === "object" && cur[s] ? cur[s] : {}) as Record<string, unknown>;
        cur[segs[segs.length - 1]] = u.value;
      }
    }
  }
  return { components: [...byId.values()], data };
}

/** Compiles a whole response. Throws the SDK's error (with its message) when it does not compile. */
export function compileExpress(reply: string, surfaceId: string) {
  const parts = expressProcessor(surfaceId).parseResponse(reply);
  const messages = parts.flatMap((p) => (p.type === "a2ui" ? p.a2ui : []));
  if (!messages.length) throw new Error("The reply has no <a2ui> block.");
  return { messages, ...surfaceOf(messages) };
}

/** The Express a list of v1.0 messages would be: what the same surface costs in Express. */
export function toExpress(messages: AgentToRendererMessage[]): string {
  return sdk().decompiler.decompile(messages);
}

/* ───────────── partial responses ───────────── */

/** Splits the inside of an `<a2ui>` block into complete statements (brackets closed, no open string). */
export function completeStatements(text: string): { statements: string[]; rest: string } {
  const start = text.indexOf("<a2ui>");
  if (start < 0) return { statements: [], rest: "" };
  const body = text.slice(start + 6).split("</a2ui>")[0];
  const statements: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (body.startsWith(quote, i)) {
        i += quote.length - 1;
        quote = null;
      }
      continue;
    }
    if (ch === '"') quote = body.startsWith('"""', i) ? '"""' : '"';
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "\n" && depth === 0) {
      const s = body.slice(from, i).trim();
      if (s && !s.startsWith("#")) statements.push(s);
      from = i + 1;
    }
  }
  return { statements, rest: body.slice(from) };
}

const KEYWORDS = new Set(["true", "false", "null", "_", "Event", "_template", "surface", "deleteSurface"]);

/** Ids a statement defines (`x = ...`) and the ids it references. */
function idsOf(statement: string) {
  const bare = statement
    .replace(/r?"""[\s\S]*?"""|r?"(?:\\.|[^"\\])*"/g, '""')
    .replace(/\$[^\s,)\]}]*/g, "")
    .replace(/\?[A-Za-z_]\w*/g, "");
  const lhs = /^\s*([A-Za-z_]\w*)\s*=(?!=)/.exec(bare);
  const used = new Set<string>();
  const re = /[A-Za-z_]\w*/g;
  const rhs = lhs ? bare.slice(lhs[0].length) : bare;
  for (let m = re.exec(rhs); m; m = re.exec(rhs)) {
    const after = rhs.slice(m.index + m[0].length).trimStart();
    if (KEYWORDS.has(m[0]) || after.startsWith("(") || /^=(?!=)/.test(after) || after.startsWith(":")) continue;
    used.add(m[0]);
  }
  return { defined: lhs?.[1], used };
}

/**
 * Compiles the complete statements of a partial response. Ids they name but
 * that are not written yet become pending Blueprint frames, and macros (which
 * expand on the server at the end) show as frames too. Returns nothing when
 * the prefix does not compile yet.
 */
export function compilePartial(statements: string[], surfaceId: string, isMacro: (name: string) => boolean): Node[] | undefined {
  const defined = new Set<string>();
  const used = new Set<string>();
  for (const s of statements) {
    const ids = idsOf(s);
    if (ids.defined) defined.add(ids.defined);
    ids.used.forEach((u) => used.add(u));
  }
  if (!defined.has("root")) return undefined;
  const stubs = [...used].filter((u) => !defined.has(u)).map((u) => `${u} = Blueprint("#${u}", "pending")`);
  try {
    const parts = previewProcessor(surfaceId).parseResponse(`<a2ui>\n${[...statements, ...stubs].join("\n")}\n</a2ui>`);
    const { components } = surfaceOf(parts.flatMap((p) => (p.type === "a2ui" ? p.a2ui : [])));
    return components.map((c) => (isMacro(c.component) ? { id: c.id, component: "Blueprint", of: c.component, state: "streaming" } : c));
  } catch {
    return undefined;
  }
}
