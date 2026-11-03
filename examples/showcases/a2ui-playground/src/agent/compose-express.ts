/**
 * The `generate_a2ui` sub-agent, writing A2UI Express.
 *
 * Same job as `./composer.ts`, in the format Google's A2UI SDKs default to:
 * the model writes plain text, one statement per component, with no tool
 * call, so any model can do it (a local Gemma included). `@a2ui/agent`
 * compiles the reply as it streams, and the surface paints as each statement
 * completes; at the end macros expand, and the result goes out as A2UI v1.0
 * operations like every other surface.
 *
 * A reply that does not compile gets one retry with the compiler's error.
 */
import type { AgentToRendererMessage, ResponsePart } from "@a2ui/agent";
import { DESIGN_RULES } from "@/a2ui/catalog/instructions";
import { macros } from "@/a2ui/macros/macros";
import type { FlatNode } from "@/a2ui/macros/macro";
import {
  compose,
  composeUserMessage,
  payloadSizes,
  type ComposeInput,
  type ComposeResult,
  type PayloadStats,
} from "./composer";
import { pipeline } from "./events";
import {
  expressProcessor,
  messagesOf,
  openExpressStream,
  pendingChildren,
  surfaceOf,
} from "./express";
import { geoBudget, geoPatch } from "./geo";
import { stripDashes } from "./repair";
import { SurfaceStream, type Node } from "./surface";
import { splitStatements } from "@/lib/express-lines";
import { COMPOSER_MAX_TOKENS, MAX_MACROS } from "@/lib/limits";

function systemPrompt(snippet: string) {
  return `You compose A2UI surfaces for a chat app, from the CopilotKit Gen UI 2.0 standard components plus this app's own components and macros. Reply with exactly one <a2ui> block and nothing else.

WRITING ORDER
- First line: root = ... . Then each parent before its children, in reading order: the surface paints line by line while you write.
- One component per line, named by what it is (head, kpis, revenue_chart). Never nest a component call inside another; reference it by name.
- Put real values inline as literals. Use $/path bindings only for input values (seed them with $/path = value lines at the end) and inside _template rows.
- Leave out an optional argument you have no value for; never write null. After one you skip, name the rest (caption="...").
- Macros (FlightCard, ProductCard, WeatherReport) are one line each; the server expands them. WeatherReport("City") fetches live weather itself.

DESIGN
${DESIGN_RULES.map((r) => `- ${r}`).join("\n")}
- Map marker names are geocoded server-side, so use the place's common name.

${snippet}`;
}

export async function composeExpress(
  input: ComposeInput,
): Promise<ComposeResult & { stats: PayloadStats }> {
  const { q, t0, toolCallId } = input;
  const startedAt = performance.now();
  pipeline(q, t0, "compose:start", {
    model: input.model.composer,
    format: "express",
  });
  const surfaceId = input.prior?.surfaceId ?? `ui-${toolCallId.slice(-6)}`;
  const processor = expressProcessor(surfaceId);
  const system = systemPrompt(processor.promptSnippet);
  const user = `${composeUserMessage(input)}${input.prior ? "\n\nWrite the whole updated surface as one <a2ui> block." : ""}`;

  const stream = new SurfaceStream(q, surfaceId);
  const progressive = !input.prior;
  if (progressive) stream.create();
  const sent = new Map<string, string>();
  const send = (...nodes: Node[]) => {
    const changed = nodes.filter((n) => sent.get(n.id) !== JSON.stringify(n));
    for (const n of changed) sent.set(n.id, JSON.stringify(n));
    if (progressive) stream.upsert(...changed);
  };

  const write = async (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    live: boolean,
  ) => {
    const res = await input.client.chat.completions.create(
      {
        model: input.model.composer,
        stream: true,
        ...input.model.extra,
        ...input.model.maxTokens(COMPOSER_MAX_TOKENS),
        messages,
      },
      { signal: input.signal },
    );
    let text = "";
    let firstTokenAt = 0;
    let done = 0;
    let painted = false;
    // The SDK compiles the reply as it arrives. The first statement that does not compile ends the stream,
    // and the surface stops painting there; `error` is what the retry tells the model.
    const express = openExpressStream(surfaceId);
    const parsed: AgentToRendererMessage[] = [];
    let error: unknown;
    const read = (parts: () => ResponsePart[]) => {
      if (error) return;
      try {
        const fresh = messagesOf(parts());
        if (!fresh.length) return;
        parsed.push(...fresh);
        if (live) paint();
      } catch (err) {
        error = err;
      }
    };
    // Components named but not written yet show as pending Blueprint frames, and macros (which expand on
    // the server at the end) as frames of their own.
    const paint = () => {
      const { components } = surfaceOf(parsed);
      const frame: Node[] = [
        ...components.map((c) =>
          macros.isMacro(c.component)
            ? {
                id: c.id,
                component: "Blueprint",
                of: c.component,
                state: "streaming",
              }
            : c,
        ),
        ...pendingChildren(components).map((id) => ({
          id,
          component: "Blueprint",
          of: `#${id}`,
          state: "pending",
        })),
      ];
      send(...stripDashes(frame));
      if (!painted) {
        painted = true;
        pipeline(q, t0, "paint", {
          components: frame.length,
          progressive: true,
        });
      }
    };
    // Every complete statement goes to the browser as written, also when the surface does not paint as it streams
    // (an update, or the retry after a compile error): the playground shows the lines as they arrive.
    const announce = (statements: string[]) => {
      for (const s of statements.slice(done)) {
        const m = /^\s*([A-Za-z_]\w*)\s*=\s*([A-Z]\w*)\(/.exec(s);
        if (m)
          pipeline(q, t0, "compose:component", {
            id: m[1],
            component: m[2],
            n: statements.length,
            chars: s.length,
            line: s,
            format: "express",
            ...(macros.isMacro(m[2]) ? { macro: true } : {}),
          });
        else pipeline(q, t0, "compose:line", { line: s, format: "express" });
      }
      done = statements.length;
    };
    for await (const chunk of res) {
      const delta = chunk.choices[0]?.delta?.content;
      if (!delta) continue;
      if (!firstTokenAt) {
        firstTokenAt = performance.now();
        pipeline(q, t0, "compose:first-token");
      }
      text += delta;
      read(() => express.feed(delta));
      if (delta.includes("\n") && text.includes("<a2ui>"))
        announce(splitStatements(text, false));
    }
    // A reply can end without its </a2ui> tag. Closing the block for it still checks the finished tree,
    // so a reply cut off mid-tree gets the retry rather than a surface with holes.
    if (express.isInBlock) read(() => express.feed("\n</a2ui>"));
    read(() => express.close());
    // The retry quotes the error to the model, and the stream can number a syntax error's line wrongly (in 0.1.0 it
    // depends on where the chunks split), so the error comes from compiling the whole reply when that fails too.
    if (error)
      try {
        expressProcessor(surfaceId).parseResponse(text);
      } catch (err) {
        error = err;
      }
    if (!error && !parsed.length)
      error = new Error("The reply has no <a2ui> block.");
    // The last statement can end at </a2ui> with no newline after it.
    if (text.includes("<a2ui>"))
      announce(splitStatements(text, text.includes("</a2ui>")));
    return { text, firstTokenAt, parsed, error };
  };
  /** The reply's components and data. Throws the compiler's error when it did not compile. */
  const resultOf = (reply: Awaited<ReturnType<typeof write>>) => {
    if (reply.error) throw reply.error;
    return surfaceOf(reply.parsed);
  };

  const conversation: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let reply = await write(conversation, progressive);
  let compiled: ReturnType<typeof resultOf>;
  try {
    compiled = resultOf(reply);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pipeline(q, t0, "validate", {
      ok: false,
      errors: [`Express did not compile: ${message}`],
      components: 0,
      retry: true,
    });
    conversation.push(
      { role: "assistant", content: reply.text },
      {
        role: "user",
        content: `That did not compile: ${message}\nReply with the whole corrected <a2ui> block.`,
      },
    );
    reply = await write(conversation, false);
    try {
      compiled = resultOf(reply);
    } catch (retryErr) {
      if (input.noFallback) throw retryErr;
      // Still no compile: write the same surface as JSON, whose repair step fixes prop types the Express compiler rejects.
      const retryMessage =
        retryErr instanceof Error ? retryErr.message : String(retryErr);
      pipeline(q, t0, "validate", {
        ok: false,
        errors: [
          `Express did not compile again: ${retryMessage}`,
          "Writing the surface as JSON instead.",
        ],
        components: 0,
        retry: true,
      });
      return compose(input);
    }
  }

  const written = stripDashes(compiled.components);
  const data = stripDashes(compiled.data);
  const errors: string[] = [];
  let expandedCount = 0;
  let macroCount = 0;
  // Macros expand (a data macro loads first) while map pins are geocoded by name, as in the JSON composer (at most 10 s).
  const expansions = Promise.all(
    written.map(async (c): Promise<Node[] | null> => {
      if (!macros.isMacro(c.component)) return null;
      try {
        if (++macroCount > MAX_MACROS)
          throw new Error(`a surface expands at most ${MAX_MACROS} macros`);
        const r = await macros.expand([c as FlatNode]);
        pipeline(q, t0, "macro", {
          id: c.id,
          macro: c.component,
          components: r.components.length,
        });
        expandedCount++;
        return r.components as Node[];
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${c.id}: ${c.component} could not expand: ${message}`);
        return [
          {
            id: c.id,
            component: "Alert",
            tone: "warning",
            title: `${c.component} is unavailable`,
            message,
          },
        ];
      }
    }),
  );
  const budget = geoBudget();
  const geo = Promise.all(
    written.map((c) =>
      macros.isMacro(c.component)
        ? null
        : geoPatch(c, { budget, signal: input.signal }).catch(() => null),
    ),
  );
  const [expanded, patches] = await Promise.all([
    expansions,
    Promise.race([
      geo,
      new Promise<null[]>((r) =>
        setTimeout(() => r(written.map(() => null)), 10000),
      ),
    ]),
  ]);
  const compiledNodes: Node[] = [];
  const components: Node[] = [];
  for (const [i, c] of written.entries()) {
    const patch = patches[i];
    if (patch)
      pipeline(q, t0, "geo", {
        id: c.id,
        component: c.component,
        geocoded: patch.note.geocoded,
        dropped: patch.note.dropped,
        unverified: patch.note.unverified,
      });
    const node = patch ? { ...c, ...patch.patch } : c;
    compiledNodes.push(node);
    components.push(...(expanded[i] ?? [node]));
  }

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
    format: "express",
    model: input.model.composer,
    outputChars: reply.text.length,
    ...payloadSizes(surfaceId, compiledNodes, components, data),
    firstTokenMs: reply.firstTokenAt
      ? Math.round(reply.firstTokenAt - startedAt)
      : null,
    composeMs: Math.round(performance.now() - startedAt),
    macros: expandedCount,
  };
  // The reply goes along as written (macros unexpanded): the inspector's JSON tab shows it as the model's Express.
  pipeline(q, t0, "format:stats", { ...stats, express: reply.text.trim() });
  return {
    surfaceId,
    written: compiledNodes,
    components,
    data,
    valid: errors.length === 0,
    errors,
    stats,
  };
}
