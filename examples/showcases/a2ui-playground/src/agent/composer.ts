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
import { A2UI_VERSION, type GenerativeUIManifest } from "@copilotkit/shared";
import { DESIGN_RULES } from "@/a2ui/catalog/instructions";
import type { FlatNode } from "@/a2ui/macros/macro";
import { macros } from "@/a2ui/macros/macros";
import { catalogPrompt } from "./catalog-prompt";
import { pipeline, type EventQueue } from "./events";
import { toExpress } from "./express";
import { geoBudget, geoPatch } from "./geo";
import type { ModelSpec } from "./models";
import { repairComponent, stripDashes } from "./repair";
import { ComponentStreamParser } from "./stream-parse";
import { CATALOG_ID } from "@/a2ui/catalog/ids";
import { COMPOSER_MAX_TOKENS, MAX_MACROS } from "@/lib/limits";
import { SurfaceStream, type Node, type SurfaceRecord } from "./surface";

export const GENERATE_A2UI_TOOL_NAME = "generate_a2ui";

const RENDER_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "render_a2ui",
    description: "Render one A2UI v1.0 surface.",
    parameters: {
      type: "object",
      properties: {
        components: {
          type: "array",
          items: { type: "object" },
          description: "Flat component list, root first.",
        },
        data: {
          type: "object",
          description: "Initial data model (form values, template items).",
        },
      },
      required: ["components"],
    },
  },
};

/**
 * Gemini's OpenAI-compatible endpoint keeps only the properties a tool schema
 * declares, so every free-form component in `render_a2ui`'s arguments arrives
 * as `{}`. Gemini and Gemma write the same JSON object as plain text instead.
 */
const writesText = (model: ModelSpec) => model.id !== "gpt";

function systemPrompt(manifest: GenerativeUIManifest, text: boolean) {
  const reply = text
    ? 'Reply with exactly one JSON object, {"components":[...],"data":{...}}: no prose and no code fence.'
    : "Call render_a2ui exactly once.";
  return `You compose A2UI v1.0 surfaces for a dark chat app, from the CopilotKit Gen UI 2.0 standard components plus this app's own components. ${reply}

FORMAT
- Write ${text ? "the keys" : "args"} in this order: components, data.
- components is FLAT: [{"id":"root","component":"Column","children":["head","kpis"]},{"id":"head","component":"Heading",...}]. One root with id "root".
- ORDER: root first, then each parent before its children, in reading order. The UI paints as you write.
- Child references are component ids: "children" (["a","b"]) or "child" ("a"), and every prop marked #id or #ids below. Never reference yourself; every id must exist.
- Put real values inline as literals. Use {"@path":"/form/x"} only for input "value" props (seed them in data) and inside templates: "children":{"componentId":"row","path":"/items"} repeats "row" per item, and the template's props read the item with relative paths ({"@path":"name"}).
- Computed values use the functions below: {"@call":"formatCurrency","args":{"value":1234,"currency":"USD"}}.
- Events: a Button's "onClick" and a card's "onAction" take {"event":{"name":"submit","context":{"email":{"@path":"/form/email"}}}}.
- Use only the components below with exactly these props. "?" = optional. S string, N number, B boolean, #id one component id, #ids ids or a template, Action an event binding.

DESIGN
${DESIGN_RULES.map((r) => `- ${r}`).join("\n")}
- Map marker names are geocoded server-side, so use the place's common name.

${catalogPrompt(manifest)}`;
}

/** Ids a component references: `child`, `children` and the `child` of tab/accordion items. */
function childRefs(c: Record<string, unknown>): string[] {
  const nested = ["tabs", "items"].flatMap((k) =>
    Array.isArray(c[k])
      ? (c[k] as Array<{ child?: unknown }>).map((t) => t?.child)
      : [],
  );
  return [
    ...(Array.isArray(c.children) ? (c.children as unknown[]) : []),
    c.child,
    ...nested,
  ].filter((r): r is string => typeof r === "string");
}

/** Drops references to components the model never wrote, so nothing waits on a frame forever. */
function pruneDangling(components: Node[]) {
  const known = new Set(components.map((c) => c.id));
  for (const c of components) {
    if (Array.isArray(c.children))
      c.children = (c.children as unknown[]).filter(
        (id) => typeof id !== "string" || known.has(id),
      );
    if (typeof c.child === "string" && !known.has(c.child)) delete c.child;
    for (const k of ["tabs", "items"]) {
      if (
        Array.isArray(c[k]) &&
        (c[k] as Array<{ child?: unknown }>).some(
          (t) => typeof t?.child === "string",
        )
      )
        c[k] = (c[k] as Array<{ child?: unknown }>).filter(
          (t) => typeof t?.child !== "string" || known.has(t.child),
        );
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
  model: ModelSpec;
  client: OpenAI;
  signal: AbortSignal;
  /** Express only: fail instead of rewriting the surface as JSON when Express does not compile (evals measure Express itself). */
  noFallback?: boolean;
};

/** What a composed surface cost, for the playground's JSON vs Express comparison. */
export type PayloadStats = {
  format: "json" | "express";
  model: string;
  /** Characters the model wrote for the surface. */
  outputChars: number;
  /** The same surface as A2UI v1.0 JSON, before macros expand. */
  jsonChars: number;
  /** The same surface in Express. */
  expressChars: number;
  /** The operations on the wire, after macros expand. */
  wireChars: number;
  firstTokenMs: number | null;
  composeMs: number;
  macros: number;
};

/** The composer's user message: the conversation, the brief, live data and, for an update, the surface to change. */
export function composeUserMessage(
  input: Pick<ComposeInput, "conversation" | "brief" | "data" | "prior">,
) {
  return [
    `Conversation so far:\n${input.conversation}`,
    `Build this UI: ${input.brief}`,
    input.data !== undefined
      ? `Live data to use (real, fetched just now; show the source in a caption):\n${JSON.stringify(input.data).slice(0, 12000)}`
      : "",
    input.prior
      ? `UPDATE this existing surface in place. Keep its structure and every part the change does not touch, and apply only the requested change:\n${JSON.stringify({ components: input.prior.components, data: input.prior.data }).slice(0, 14000)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Sizes of one surface in JSON, in Express and on the wire. */
export function payloadSizes(
  surfaceId: string,
  compiled: Node[],
  wire: Node[],
  data: Record<string, unknown>,
) {
  const op = (components: Node[]) => ({
    version: A2UI_VERSION,
    createSurface: {
      surfaceId,
      catalogId: CATALOG_ID,
      components,
      ...(Object.keys(data).length ? { dataModel: data } : {}),
    },
  });
  let expressChars = 0;
  try {
    expressChars = toExpress([op(compiled) as never]).length;
  } catch {
    /* a component the Express catalog cannot write */
  }
  return {
    jsonChars: JSON.stringify(op(compiled)).length,
    expressChars,
    wireChars: JSON.stringify(op(wire)).length,
  };
}

export type ComposeResult = SurfaceRecord & {
  /** What the model wrote, macros unexpanded. */
  written: Node[];
  components: Node[];
  data: Record<string, unknown>;
  valid: boolean;
  errors: string[];
};

export async function compose(
  input: ComposeInput,
): Promise<ComposeResult & { stats: PayloadStats }> {
  const { q, t0, toolCallId, manifest } = input;
  const user = composeUserMessage(input);
  const startedAt = performance.now();

  pipeline(q, t0, "compose:start", {
    model: input.model.composer,
    format: "json",
  });
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
    pipeline(q, t0, "paint", {
      components: parser.components.length,
      progressive: true,
      blueprint: parser.components.length === 0,
    });
  };
  const errors: string[] = [];
  const repaired = (c: Record<string, unknown>) => {
    const { component, note } = repairComponent(
      stripDashes(c) as Node,
      manifest,
    );
    if (note?.failed.length)
      errors.push(...note.failed.map((f) => `${component.id}: ${f}`));
    return { component, note };
  };

  // A macro shows as a frame while it expands (a data macro loads first); each one expands once, at most MAX_MACROS of them.
  const macroJobs = new Map<string, ReturnType<typeof macros.expand>>();
  const expandMacro = (c: Node) => {
    const key = JSON.stringify(c);
    let job = macroJobs.get(key);
    if (!job) {
      job =
        macroJobs.size < MAX_MACROS
          ? macros.expand([c as FlatNode])
          : Promise.reject(
              new Error(`a surface expands at most ${MAX_MACROS} macros`),
            );
      macroJobs.set(key, job);
      job
        .then((r) =>
          pipeline(q, t0, "macro", {
            id: c.id,
            macro: c.component,
            components: r.components.length,
          }),
        )
        .catch(() => undefined);
    }
    return job;
  };

  const text = writesText(input.model);
  const stream_ = await input.client.chat.completions.create(
    {
      model: input.model.composer,
      stream: true,
      ...input.model.extra,
      ...input.model.maxTokens(COMPOSER_MAX_TOKENS),
      ...(text
        ? {}
        : {
            tool_choice: {
              type: "function",
              function: { name: "render_a2ui" },
            } as const,
            tools: [RENDER_TOOL],
          }),
      messages: [
        { role: "system", content: systemPrompt(manifest, text) },
        { role: "user", content: user },
      ],
    },
    { signal: input.signal },
  );

  // Map components are geocoded by marker name while the rest of the surface keeps streaming.
  const geoPatched = new Map<string, Record<string, unknown>>();
  const geoJobs: Promise<void>[] = [];
  const budget = geoBudget();
  const startGeo = (c: Node) => {
    geoJobs.push(
      geoPatch(c, { budget, signal: input.signal })
        .then((r) => {
          if (!r) return;
          geoPatched.set(c.id, r.patch);
          const idx = parser.components.findIndex((x) => x.id === c.id);
          if (idx >= 0) {
            parser.components[idx] = { ...parser.components[idx], ...r.patch };
            send(parser.components[idx] as Node);
          }
          pipeline(q, t0, "geo", {
            id: c.id,
            component: c.component,
            geocoded: r.note.geocoded,
            dropped: r.note.dropped,
            unverified: r.note.unverified,
          });
        })
        .catch(() => undefined),
    );
  };

  let tokens = 0;
  let firstTokenAt = 0;
  let lastHeader = "";
  let lastProgress = 0;
  for await (const chunk of stream_) {
    const delta = text
      ? chunk.choices[0]?.delta?.content
      : chunk.choices[0]?.delta?.tool_calls?.[0]?.function?.arguments;
    if (!delta) continue;
    if (!firstTokenAt) {
      pipeline(q, t0, "compose:first-token");
      firstTokenAt = performance.now();
    }
    tokens += delta.length / 4;
    const found = parser.push(delta);
    for (const c of found) {
      if (macros.isMacro(c.component)) {
        const call = stripDashes(c) as Node;
        pipeline(q, t0, "compose:component", {
          id: c.id,
          component: c.component,
          n: parser.components.length,
          chars: JSON.stringify(c).length,
          line: JSON.stringify(c),
          format: "json",
          macro: true,
        });
        send({
          id: call.id,
          component: "Blueprint",
          of: call.component,
          state: "streaming",
        });
        paint();
        expandMacro(call)
          .then((r) => send(...(r.components as Node[])))
          .catch(() => undefined);
        continue;
      }
      const idx = parser.components.indexOf(c);
      const { component, note } = repaired(c);
      if (idx >= 0) parser.components[idx] = component;
      startGeo(component);
      // The component as the model wrote it (before repair) is its line in the playground's live view.
      pipeline(q, t0, "compose:component", {
        id: c.id,
        component: c.component,
        n: parser.components.length,
        chars: JSON.stringify(c).length,
        line: JSON.stringify(c),
        format: "json",
        ...(note ? { repaired: note.fixed, failed: note.failed } : {}),
      });
      // The real component replaces its frame; children it names but that have not started get labelled pending frames.
      const pending = childRefs(component)
        .filter((id) => !sent.has(id))
        .map(
          (id): Node => ({
            id,
            component: "Blueprint",
            of: `#${id}`,
            state: "pending",
          }),
        );
      send(
        note?.failed.length
          ? {
              id: component.id,
              component: "Blueprint",
              of: component.component,
              state: "failed",
            }
          : component,
        ...pending,
      );
      paint();
    }
    // A new component id is readable before its props are complete: draw its frame now.
    const open = parser.open;
    if (open && open.id !== lastHeader) {
      lastHeader = open.id;
      pipeline(q, t0, "compose:header", {
        id: open.id,
        component: open.component,
        n: parser.components.length + 1,
      });
      if (
        !sent.has(open.id) ||
        JSON.parse(sent.get(open.id)!).component === "Blueprint"
      )
        send({
          id: open.id,
          component: "Blueprint",
          of: open.component,
          state: "streaming",
        });
      paint();
    }
    const now = performance.now();
    if (now - lastProgress > 120) {
      lastProgress = now;
      const secs = Math.max(0.001, (now - firstTokenAt) / 1000);
      pipeline(q, t0, "compose:progress", {
        id: open?.id,
        component: open?.component,
        chars: parser.openChars,
        tokens: Math.round(tokens),
        tps: Math.round(tokens / secs),
      });
    }
  }
  // Geocoding runs alongside composing; never hold the finished surface more than 10 s for it (8 paced Nominatim lookups fit).
  if (geoJobs.length)
    await Promise.race([
      Promise.all(geoJobs),
      new Promise((r) => setTimeout(r, 10000)),
    ]);

  let args: {
    components?: Array<Record<string, unknown>>;
    data?: Record<string, unknown>;
  } = {};
  try {
    // Text replies can still arrive inside a code fence: parse from the first brace to the last.
    const raw = parser.raw;
    args = JSON.parse(
      text
        ? raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1) || "{}"
        : raw || "{}",
    );
  } catch {
    args = { components: parser.components };
  }
  errors.length = 0;
  const written =
    Array.isArray(args.components) && args.components.length
      ? args.components
      : parser.components;
  const compiled: Node[] = [];
  const components: Node[] = [];
  let expandedCount = 0;
  for (const c of written) {
    if (macros.isMacro(c.component)) {
      const call = stripDashes(c) as Node;
      compiled.push(call);
      try {
        const r = await expandMacro(call);
        components.push(...(r.components as Node[]));
        expandedCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(
          `${call.id}: ${call.component} could not expand: ${message}`,
        );
        components.push({
          id: call.id,
          component: "Alert",
          tone: "warning",
          title: `${call.component} is unavailable`,
          message,
        });
      }
      continue;
    }
    const { component } = repaired(c);
    const done = geoPatched.has(component.id)
      ? { ...component, ...geoPatched.get(component.id) }
      : component;
    compiled.push(done);
    components.push(done);
  }
  pruneDangling(components);
  const data = stripDashes(
    args.data && typeof args.data === "object" ? args.data : {},
  );

  // The data lands before the final components, so every binding resolves as they swap in.
  if (!progressive) stream.reopen();
  stream.data(data);
  if (progressive) send(...components);
  else stream.upsert(...components);
  stream.close();
  pipeline(q, t0, "validate", {
    ok: errors.length === 0,
    errors: errors.slice(0, 5),
    components: components.length,
  });
  const stats: PayloadStats = {
    format: "json",
    model: input.model.composer,
    outputChars: parser.raw.length,
    ...payloadSizes(surfaceId, compiled, components, data),
    firstTokenMs: firstTokenAt ? Math.round(firstTokenAt - startedAt) : null,
    composeMs: Math.round(performance.now() - startedAt),
    macros: expandedCount,
  };
  pipeline(q, t0, "format:stats", stats);
  return {
    surfaceId,
    written: compiled,
    components,
    data,
    valid: errors.length === 0,
    errors,
    stats,
  };
}
