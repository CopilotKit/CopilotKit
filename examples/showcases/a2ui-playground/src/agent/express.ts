/**
 * A2UI Express with Google's `@a2ui/agent` SDK.
 *
 * Express is the compact, Python-like inference format the A2UI SDKs default
 * to: the model writes one statement per component (`kpi = Stat("Revenue",
 * "$4.2M")`), and the SDK compiles it, against the catalog, into standard
 * A2UI 1.0 messages. It needs no tool calling, so any LLM can write it.
 *
 * SDK 0.1 reads each response incrementally. Blueprint frames are a
 * playground presentation of pending children and server-side macros.
 */
import {
  A2uiGenerator,
  CatalogConfig,
  ExpressDecompiler,
  ExpressFormatFactory,
  InMemoryCatalogProvider,
} from "@a2ui/agent";
import type { A2uiRequestProcessor, AgentToRendererMessage } from "@a2ui/agent";
import { collectChildRefs, childIdsAtRefs } from "@copilotkit/shared";
import type { GenerativeUIManifest } from "@copilotkit/shared";
import inference from "@/a2ui/export/inference-catalog.json";
import type { Node } from "./surface";

type Doc = typeof inference & { components: Record<string, unknown> };
const doc = inference as Doc;
const CAPS = { "1.0": { supportedCatalogIds: [doc.catalogId] } };

let generators:
  | {
      main: A2uiGenerator;
      decompiler: ExpressDecompiler;
    }
  | undefined;
function sdk() {
  if (!generators) {
    const main = new CatalogConfig(
      new InMemoryCatalogProvider(
        doc as unknown as Record<string, unknown>,
      ).load(),
    );
    generators = {
      main: new A2uiGenerator([main]),
      decompiler: new ExpressDecompiler(main.catalog, "1.0"),
    };
  }
  return generators;
}

export const expressProcessor = (surfaceId: string): A2uiRequestProcessor =>
  sdk().main.createProcessor(CAPS, new ExpressFormatFactory({ surfaceId }));
/** Components and data model after a list of compiled messages. */
export function surfaceOf(messages: AgentToRendererMessage[]): {
  components: Node[];
  data: Record<string, unknown>;
} {
  const byId = new Map<string, Node>();
  let data: Record<string, unknown> = {};
  for (const m of messages as Array<Record<string, any>>) {
    for (const c of (m.createSurface?.components ??
      m.updateComponents?.components ??
      []) as Node[])
      byId.set(c.id, c);
    if (m.createSurface?.dataModel)
      data = { ...data, ...m.createSurface.dataModel };
    const u = m.updateDataModel as
      | { path?: string; value?: unknown }
      | undefined;
    if (u) {
      const segs = (u.path ?? "/").split("/").filter(Boolean);
      if (!segs.length)
        data = { ...data, ...(u.value as Record<string, unknown>) };
      else {
        let cur = data;
        for (const s of segs.slice(0, -1))
          cur = (cur[s] =
            typeof cur[s] === "object" && cur[s] ? cur[s] : {}) as Record<
            string,
            unknown
          >;
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

/** The Express a list of 1.0 messages would be: what the same surface costs in Express. */
export function toExpress(messages: AgentToRendererMessage[]): string {
  return sdk().decompiler.decompile(messages);
}

/* Code-pane line announcements only. Compilation uses the SDK stream. */

/** Splits the inside of an `<a2ui>` block into complete statements (brackets closed, no open string). */
export function completeStatements(text: string): {
  statements: string[];
  rest: string;
} {
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

/** Add app-specific frames to SDK-compiled components, without recompiling the prefix. */
export function previewComponents(
  components: Node[],
  known: Set<string>,
  manifest: GenerativeUIManifest,
  isMacro: (name: string) => boolean,
): Node[] {
  for (const component of components) known.add(component.id);
  const pending = new Set<string>();
  for (const component of components) {
    // The host manifest keeps literal child refs and slots before portable
    // catalog export wraps every prop in binding/function alternatives.
    const entry = manifest.components[component.component];
    if (!entry) continue;
    const refs = [
      ...collectChildRefs(entry.props),
      ...Object.entries(entry.slots ?? {}).map(([name, kind]) => ({
        path: [name],
        kind,
      })),
    ];
    for (const id of childIdsAtRefs(component, refs))
      if (!known.has(id)) pending.add(id);
  }
  return [
    ...components.map((component) =>
      isMacro(component.component)
        ? {
            id: component.id,
            component: "Blueprint",
            of: component.component,
            state: "streaming",
          }
        : component,
    ),
    ...[...pending].map((id) => ({
      id,
      component: "Blueprint",
      of: `#${id}`,
      state: "pending",
    })),
  ];
}
