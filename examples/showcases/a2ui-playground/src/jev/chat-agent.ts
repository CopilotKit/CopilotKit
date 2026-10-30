/**
 * The chat version's agent: a CopilotKit BuiltInAgent in custom-factory mode.
 * Each turn is one Jev call (no language model): the decision goes out as a CUSTOM
 * event and the deterministic surface as a Gen UI 2.0 `generative-ui-surface`
 * activity (one A2UI v1.0 createSurface).
 */
import type { RunAgentInput } from "@ag-ui/client";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { EventQueue, EventType } from "@/agent/events";
import { SurfaceStream, type Node } from "@/agent/surface";
import { runJev } from "./decide.server";
import type { UseCaseId } from "./usecases";

async function run(
  input: RunAgentInput,
  signal: AbortSignal | undefined,
  q: EventQueue,
) {
  const props = (input.forwardedProps ?? {}) as {
    fixture?: boolean;
    usecase?: UseCaseId;
  };
  const last = [...input.messages].reverse().find((m) => m.role === "user");
  const prompt = typeof last?.content === "string" ? last.content : "";
  const r = await runJev({
    usecase: props.usecase ?? "cafes",
    prompt,
    fixture: !!props.fixture,
    signal,
  });
  if ("notice" in r) {
    q.push({
      type: EventType.CUSTOM,
      name: "jev.notice",
      value: { message: r.notice, places: r.places },
    });
    return;
  }
  q.push({
    type: EventType.CUSTOM,
    name: "jev.decision",
    value: {
      jevMs: r.jevMs,
      places: r.places,
      source: r.source,
      model: r.model,
      layout: r.layout,
      layoutProbabilities: r.layoutProbabilities,
      ranked: r.ranked,
      questionCount: r.questionCount,
    },
  });
  const create = (
    r.ops[0] as {
      createSurface: {
        surfaceId: string;
        components: Node[];
        dataModel: Record<string, unknown>;
      };
    }
  ).createSurface;
  const stream = new SurfaceStream(q, create.surfaceId);
  stream.create(create.components, create.dataModel);
  stream.close();
}

export function createJevChatAgent() {
  return new BuiltInAgent({
    type: "custom",
    factory: ({ input, abortSignal }) => {
      const q = new EventQueue();
      run(input, abortSignal, q)
        .catch((err) => {
          const raw = err instanceof Error ? err.message : String(err);
          console.error("[jev-chat]", raw);
          const message = /free tier/i.test(raw)
            ? "Jev needs paid AI Gateway credits on this team"
            : raw.split(/(?<=\.)\s/)[0].slice(0, 110);
          q.push({
            type: EventType.CUSTOM,
            name: "jev.error",
            value: { message },
          });
        })
        .finally(() => q.close());
      return q;
    },
  });
}
