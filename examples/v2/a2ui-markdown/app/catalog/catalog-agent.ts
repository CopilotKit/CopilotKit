import { EventType, HttpAgent } from "@copilotkit/react-core";
import type { CatalogSample } from "./samples";
import {
  sampleOperations,
  sampleSurfaceId,
} from "../../../../../showcase/shared/generative-ui-catalog/operations";
export {
  sampleOperations,
  sampleSurfaceId,
} from "../../../../../showcase/shared/generative-ui-catalog/operations";

/** The activity type of a generative UI surface on the AG-UI wire. */
const SURFACE_ACTIVITY_TYPE = "generative-ui-surface";

/** The thread and run ids of the run request, read from its JSON body. */
function runIdsOf(body: BodyInit | null | undefined) {
  const input: unknown = typeof body === "string" ? JSON.parse(body) : null;
  const isObject = typeof input === "object" && input !== null;
  const threadId =
    isObject && "threadId" in input && typeof input.threadId === "string"
      ? input.threadId
      : crypto.randomUUID();
  const runId =
    isObject && "runId" in input && typeof input.runId === "string"
      ? input.runId
      : crypto.randomUUID();
  return { threadId, runId };
}

/**
 * A scripted agent with no model and no server. Each run streams one
 * surface per sample, each into the target `sample-<index>`, the same way
 * the runtime streams a `render_ui` call. A user event starts a new run,
 * which streams the same surfaces again.
 */
export function createCatalogAgent(
  samples: CatalogSample[],
  catalogId: string,
) {
  return new HttpAgent({
    agentId: "default",
    url: "/catalog/agent",
    fetch: async (_url, init) => {
      const { threadId, runId } = runIdsOf(init.body);
      const surfaces = samples.map((sample, index) => {
        const surfaceId = sampleSurfaceId(index);
        return {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: `genui:${surfaceId}`,
          activityType: SURFACE_ACTIVITY_TYPE,
          replace: true,
          content: {
            surfaceId,
            target: surfaceId,
            catalogId,
            operations: sampleOperations(sample, surfaceId, catalogId),
            status: "ready",
            rejected: [],
          },
        };
      });
      const events = [
        { type: EventType.RUN_STARTED, threadId, runId },
        ...surfaces,
        { type: EventType.RUN_FINISHED, threadId, runId },
      ];
      const stream = events
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });
}
