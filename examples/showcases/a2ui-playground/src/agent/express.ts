/**
 * A2UI Express with Google's `@a2ui/agent` SDK.
 *
 * Express is the compact, Python-like inference format the A2UI SDKs default
 * to: the model writes one statement per component (`kpi = Stat("Revenue",
 * "$4.2M")`), and the SDK compiles it, against the catalog, into standard
 * A2UI 1.0 messages. It needs no tool calling, so any LLM can write it.
 *
 * The SDK also compiles a reply while it streams (`openExpressStream`): each
 * statement comes back as soon as it is complete, which is how an Express
 * surface paints while the model is still writing.
 */
import {
  A2uiGenerator,
  CatalogConfig,
  ExpressDecompiler,
  ExpressFormatFactory,
  InMemoryCatalogProvider,
} from "@a2ui/agent";
import type {
  A2uiRequestProcessor,
  AgentToRendererMessage,
  StreamPart,
  ResponseStream,
} from "@a2ui/agent";
import { childIdsAtRefs, collectChildRefs } from "@copilotkit/shared";
import type { GenerativeUIManifest } from "@copilotkit/shared";
import inference from "@/a2ui/export/inference-catalog.json";
import type { Node } from "./surface";

type Doc = typeof inference & { components: Record<string, unknown> };
const doc = inference as Doc;
// The SDK and published CopilotKit 1.84 both use canonical "1.0".
const CAPS = { "1.0": { supportedCatalogIds: [doc.catalogId] } };

let generators:
  | { main: A2uiGenerator; decompiler: ExpressDecompiler }
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

/**
 * Compiles a reply as it streams: `feed` each chunk, then `close`. Each
 * returns what it completed: `createSurface` once `root = ...` is written, then
 * each statement's components and data. Rejected blocks return the SDK error
 * alongside any completed parts; `close` also checks the finished tree.
 */
export const openExpressStream = (
  surfaceId: string,
): ResponseStream<StreamPart> =>
  expressProcessor(surfaceId).openStream({ afterRejectedBlock: "continue" });

/** The A2UI messages among parsed parts. */
export const messagesOf = (parts: StreamPart[]): AgentToRendererMessage[] =>
  parts.flatMap((p) => (p.type === "a2ui" ? p.a2ui : []));

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

/** The Express a list of 1.0 messages would be: what the same surface costs in Express. */
export function toExpress(messages: AgentToRendererMessage[]): string {
  return sdk().decompiler.decompile(messages);
}

/** Ids the components name as children that this streaming reply has not written yet. */
export function pendingChildren(
  components: Node[],
  manifest: GenerativeUIManifest,
): string[] {
  const written = new Set(components.map((component) => component.id));
  const pending = new Set<string>();
  for (const component of components) {
    // Literal host schemas retain nested refs before portable catalog export
    // wraps properties in binding/function alternatives. Slots are separate.
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
      if (!written.has(id)) pending.add(id);
  }
  return [...pending];
}
