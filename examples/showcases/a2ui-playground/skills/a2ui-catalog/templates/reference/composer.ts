// Reference implementation copied from the a2ui-playground build (working, measured).
// Paths like @/a2ui/... are app-specific: adapt imports to your project.
/**
 * The `generate_a2ui` sub-agent.
 *
 * A second, faster model writes the whole surface (components + data) as the
 * arguments of a forced `render_a2ui` tool call. We parse those arguments as
 * they stream and append an A2UI v1.0 `updateComponents` operation to the
 * surface after every completed component, so the surface paints top-down
 * while it is still being written instead of after the last byte.
 */
import OpenAI from "openai";
import type { GenerativeUIManifest } from "@copilotkit/shared";
import { catalogPrompt } from "./catalog-prompt";
import { pipeline, type EventQueue } from "./events";
import { MAP_POINT_PROPS, repairMarkers } from "./geo";
import { repairComponent, stripDashes } from "./repair";
import { ComponentStreamParser } from "./stream-parse";
import { SurfaceStream, type Node, type SurfaceRecord } from "./surface";

export const COMPOSER_MODEL = process.env.A2UI_COMPOSER_MODEL ?? "gpt-5.4-mini";
export const GENERATE_A2UI_TOOL_NAME = "generate_a2ui";

const RENDER_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "render_a2ui",
    description: "Render one A2UI v1.0 surface.",
    parameters: {
      type: "object",
      properties: {
        components: { type: "array", items: { type: "object" }, description: "Flat component list, root first." },
        data: { type: "object", description: "Initial data model (form values, template items)." },
      },
      required: ["components"],
    },
  },
};

function systemPrompt(manifest: GenerativeUIManifest) {
  return `You compose A2UI v1.0 surfaces for a dark chat app, from the CopilotKit Gen UI 2.0 standard components plus this app's own components. Call render_a2ui exactly once.

FORMAT
- Write args in this order: components, data.
- components is FLAT: [{"id":"root","component":"Column","children":["head","kpis"]},{"id":"head","component":"Heading",...}]. One root with id "root".
- ORDER: root first, then each parent before its children, in reading order. The UI paints as you write.
- Child references are component ids: "children" (["a","b"]) or "child" ("a"), and every prop marked #id or #ids below. Never reference yourself; every id must exist.
- Put real values inline as literals. Use {"@path":"/form/x"} only for input "value" props (seed them in data) and inside templates: "children":{"componentId":"row","path":"/items"} repeats "row" per item, and the template's props read the item with relative paths ({"@path":"name"}).
- Computed values use the functions below: {"@call":"formatCurrency","args":{"value":1234,"currency":"USD"}}.
- Events: a Button's "onClick" and a card's "onAction" take {"event":{"name":"submit","context":{"email":{"@path":"/form/email"}}}}.
- Use only the components below with exactly these props. "?" = optional. S string, N number, B boolean, #id one component id, #ids ids or a template, Action an event binding.

DESIGN
- Fully answer the request. Lead with a Heading, then the component built for the job: comparisons -> ComparisonTable, plans/options -> RadioGroup or ProductCard, schedules -> Agenda or Timeline, code -> CodeBlock, people -> ProfileCard or Avatar/AvatarGroup, statuses -> Badge, ratings -> Rating, a single ratio or score -> RadialProgress or Gauge, recipes -> RecipeCard, events -> EventCard, products -> ProductCard. Pick the richest component that fits: charts for numbers over time or comparisons, MapView for places, DataTable for many rows, Timeline for sequences, domain cards when they match.
- Layout with Column, Row and Grid (standard). Use Card only for an interactive panel (a form, controls) and Section to group with a title. Short text is Text, Title or Caption; prose is Markdown.
- Make the layout make sense: one chart per question unless the user asks for more, never two charts or a chart plus a table showing the same numbers, and never a chart whose series is flat or has under 3 points (use a Stat instead).
- Put KPIs in a Grid of Stat (add a Sparkline when a trend matters). Aim for 8 to 18 components, never more than 20: show each fact once (never the same list in both a map and a table), prefer one rich component over many small ones, but use small ones (Badge, Avatar, Divider) where they carry meaning.
- Concise copy, specific realistic data. If numbers are illustrative (no live source), end with a Caption saying "Illustrative data".
- Multi-series charts share one axis: only combine series of similar magnitude. Otherwise plot % change from a common start, or use one chart per series.
- Percent values are 0-100 (12.4 means 12.4%) with format "percent"; never fractions.
- Subtitles describe the content ("Revenue grew 12% on EMEA renewals"), never the UI itself.
- Maps: at most 8 markers, each a specific named place (landmark, venue, neighbourhood) that the plan text mentions, one per stop. Never use the city itself as a marker. Names are geocoded server-side, so use the place's common name.
- Stat values are short numbers; put qualitative takeaways in KeyValueList, Callout or Markdown.
- Write final copy. Never say "placeholder", "sample text" or "lorem". Never use em dashes.

${catalogPrompt(manifest)}`;
}

/** Distances shown in a PlaceList must match the geocoded pins: distance from the previous stop. */
function withLegDistances(points: Array<Record<string, unknown>>) {
  const rad = (d: number) => (d * Math.PI) / 180;
  return points.map((p, i) => {
    const { distanceKm: _drop, ...rest } = p;
    void _drop;
    if (i === 0) return rest;
    const a = points[i - 1] as { lat: number; lon: number };
    const b = p as { lat: number; lon: number };
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return { ...rest, distanceKm: Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 10) / 10 };
  });
}

/** Ids a component references: `child`, `children` and the `child` of tab/accordion items. */
function childRefs(c: Record<string, unknown>): string[] {
  const nested = ["tabs", "items"].flatMap((k) => (Array.isArray(c[k]) ? (c[k] as Array<{ child?: unknown }>).map((t) => t?.child) : []));
  return [...(Array.isArray(c.children) ? (c.children as unknown[]) : []), c.child, ...nested].filter((r): r is string => typeof r === "string");
}

/** Drops references to components the model never wrote, so nothing waits on a frame forever. */
function pruneDangling(components: Node[]) {
  const known = new Set(components.map((c) => c.id));
  for (const c of components) {
    if (Array.isArray(c.children)) c.children = (c.children as unknown[]).filter((id) => typeof id !== "string" || known.has(id));
    if (typeof c.child === "string" && !known.has(c.child)) delete c.child;
    for (const k of ["tabs", "items"]) {
      if (Array.isArray(c[k]) && (c[k] as Array<{ child?: unknown }>).some((t) => typeof t?.child === "string"))
        c[k] = (c[k] as Array<{ child?: unknown }>).filter((t) => typeof t?.child !== "string" || known.has(t.child));
    }
  }
}

export type ComposeInput = {
  brief: string;
  conversation: string;
  data?: unknown;
  /** Update in place: the composer rewrites this surface; nothing is streamed until it is complete. */
  prior?: SurfaceRecord;
  /** The catalog the browser sent in the generative UI envelope. */
  manifest: GenerativeUIManifest;
  toolCallId: string;
  t0: number;
  q: EventQueue;
  client: OpenAI;
  signal: AbortSignal;
};

export type ComposeResult = SurfaceRecord & {
  components: Node[];
  data: Record<string, unknown>;
  valid: boolean;
  errors: string[];
};

export async function compose(input: ComposeInput): Promise<ComposeResult> {
  const { q, t0, toolCallId, manifest } = input;
  const user = [
    `Conversation so far:\n${input.conversation}`,
    `Build this UI: ${input.brief}`,
    input.data !== undefined ? `Live data to use (real, fetched just now; show the source in a caption):\n${JSON.stringify(input.data).slice(0, 12000)}` : "",
    input.prior
      ? `UPDATE this existing surface in place. Keep its structure and every part the change does not touch, and apply only the requested change:\n${JSON.stringify({ components: input.prior.components, data: input.prior.data }).slice(0, 14000)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  pipeline(q, t0, "compose:start", { model: COMPOSER_MODEL });
  const surfaceId = input.prior?.surfaceId ?? `ui-${toolCallId.slice(-6)}`;
  const stream = new SurfaceStream(q, surfaceId);
  // An update must not blank the card the user is looking at: stream silently, apply once at the end.
  const progressive = !input.prior;
  if (progressive) stream.create();

  const parser = new ComponentStreamParser();
  /** What the browser has for each id, so a component is only sent again when it changed. */
  const sent = new Map<string, string>();
  const send = (...nodes: Node[]) => {
    const changed = nodes.filter((n) => sent.get(n.id) !== JSON.stringify(n));
    for (const n of changed) sent.set(n.id, JSON.stringify(n));
    if (progressive) stream.upsert(...changed);
  };
  let painted = false;
  const paint = () => {
    if (painted || !progressive) return;
    painted = true;
    pipeline(q, t0, "paint", { components: parser.components.length, progressive: true, blueprint: parser.components.length === 0 });
  };
  const errors: string[] = [];
  const repaired = (c: Record<string, unknown>) => {
    const { component, note } = repairComponent(stripDashes(c) as Node, manifest);
    if (note?.failed.length) errors.push(...note.failed.map((f) => `${component.id}: ${f}`));
    return { component, note };
  };

  const stream_ = await input.client.chat.completions.create(
    {
      model: COMPOSER_MODEL,
      stream: true,
      reasoning_effort: "none",
      tool_choice: { type: "function", function: { name: "render_a2ui" } },
      tools: [RENDER_TOOL],
      messages: [
        { role: "system", content: systemPrompt(manifest) },
        { role: "user", content: user },
      ],
    },
    { signal: input.signal },
  );

  // Map components are geocoded by marker name while the rest of the surface keeps streaming.
  const geoPatched = new Map<string, Record<string, unknown>>();
  const geoJobs: Promise<void>[] = [];
  const startGeo = (c: Node) => {
    const isCard = c.component === "LocationCard" && typeof c.name === "string";
    const prop = MAP_POINT_PROPS[c.component];
    const points = isCard ? [{ name: c.name, lat: c.lat, lon: c.lon }] : prop && Array.isArray(c[prop]) ? (c[prop] as Array<Record<string, unknown>>) : null;
    if (!points?.length) return;
    geoJobs.push(
      repairMarkers(points)
        .then((r) => {
          if (!r) return;
          const patch: Record<string, unknown> = isCard
            ? r.markers[0] ? { lat: r.markers[0].lat, lon: r.markers[0].lon } : {}
            : { [prop!]: prop === "places" ? withLegDistances(r.markers) : r.markers };
          geoPatched.set(c.id, patch);
          const idx = parser.components.findIndex((x) => x.id === c.id);
          if (idx >= 0) {
            parser.components[idx] = { ...parser.components[idx], ...patch };
            send(parser.components[idx] as Node);
          }
          pipeline(q, t0, "geo", { id: c.id, component: c.component, geocoded: r.note.geocoded, dropped: r.note.dropped, unverified: r.note.unverified });
        })
        .catch(() => undefined),
    );
  };

  let tokens = 0;
  let firstTokenAt = 0;
  let lastHeader = "";
  let lastProgress = 0;
  for await (const chunk of stream_) {
    const delta = chunk.choices[0]?.delta?.tool_calls?.[0]?.function?.arguments;
    if (!delta) continue;
    if (!firstTokenAt) {
      pipeline(q, t0, "compose:first-token");
      firstTokenAt = performance.now();
    }
    tokens += delta.length / 4;
    const found = parser.push(delta);
    for (const c of found) {
      const idx = parser.components.indexOf(c);
      const { component, note } = repaired(c);
      if (idx >= 0) parser.components[idx] = component;
      startGeo(component);
      pipeline(q, t0, "compose:component", { id: c.id, component: c.component, n: parser.components.length, chars: JSON.stringify(c).length, ...(note ? { repaired: note.fixed, failed: note.failed } : {}) });
      // The real component replaces its frame; children it names but that have not started get labelled pending frames.
      const pending = childRefs(component)
        .filter((id) => !sent.has(id))
        .map((id): Node => ({ id, component: "Blueprint", of: `#${id}`, state: "pending" }));
      send(note?.failed.length ? { id: component.id, component: "Blueprint", of: component.component, state: "failed" } : component, ...pending);
      paint();
    }
    // A new component id is readable before its props are complete: draw its frame now.
    const open = parser.open;
    if (open && open.id !== lastHeader) {
      lastHeader = open.id;
      pipeline(q, t0, "compose:header", { id: open.id, component: open.component, n: parser.components.length + 1 });
      if (!sent.has(open.id) || JSON.parse(sent.get(open.id)!).component === "Blueprint") send({ id: open.id, component: "Blueprint", of: open.component, state: "streaming" });
      paint();
    }
    const now = performance.now();
    if (now - lastProgress > 120) {
      lastProgress = now;
      const secs = Math.max(0.001, (now - firstTokenAt) / 1000);
      pipeline(q, t0, "compose:progress", { id: open?.id, component: open?.component, chars: parser.openChars, tokens: Math.round(tokens), tps: Math.round(tokens / secs) });
    }
  }
  // Geocoding runs alongside composing; never hold the finished surface more than 10 s for it (8 paced Nominatim lookups fit).
  if (geoJobs.length) await Promise.race([Promise.all(geoJobs), new Promise((r) => setTimeout(r, 10000))]);

  let args: { components?: Array<Record<string, unknown>>; data?: Record<string, unknown> } = {};
  try {
    args = JSON.parse(parser.raw || "{}");
  } catch {
    args = { components: parser.components };
  }
  errors.length = 0;
  const components = (Array.isArray(args.components) && args.components.length ? args.components : parser.components).map((c) => {
    const { component } = repaired(c);
    return geoPatched.has(component.id) ? { ...component, ...geoPatched.get(component.id) } : component;
  });
  pruneDangling(components);
  const data = stripDashes(args.data && typeof args.data === "object" ? args.data : {});

  // The data lands before the final components, so every binding resolves as they swap in.
  if (!progressive) stream.reopen();
  stream.data(data);
  if (progressive) send(...components);
  else stream.upsert(...components);
  stream.close();
  pipeline(q, t0, "validate", { ok: errors.length === 0, errors: errors.slice(0, 5), components: components.length });
  return { surfaceId, components, data, valid: errors.length === 0, errors };
}
