import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";

export const CATALOG_AGENT_ID = "generative-ui-catalog";

/**
 * A scripted agent with no model and no server for the standard components
 * page. Each run streams one surface per shared catalog sample into the
 * target `sample-<index>`, the way the runtime streams a `render_ui` call.
 * A user event starts a new run, which streams the same surfaces again.
 *
 * The samples load on the first run, so registering the agent in the app
 * config keeps them out of the initial bundle.
 */
export class CatalogAgent extends AbstractAgent {
  constructor(private readonly catalogId: string) {
    super({ agentId: CATALOG_AGENT_ID });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((observer) => {
      const emit = (event: Record<string, unknown>) =>
        observer.next(event as BaseEvent);
      void Promise.all([
        import("../../../../../../../../showcase/shared/generative-ui-catalog/samples"),
        import("../../../../../../../../showcase/shared/generative-ui-catalog/operations"),
      ]).then(
        ([{ SAMPLES }, { sampleOperations, sampleSurfaceId }]) => {
          emit({
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          });
          SAMPLES.forEach((sample, index) => {
            const surfaceId = sampleSurfaceId(index);
            emit({
              type: EventType.ACTIVITY_SNAPSHOT,
              messageId: `genui:${surfaceId}`,
              activityType: "generative-ui-surface",
              replace: true,
              content: {
                surfaceId,
                target: surfaceId,
                catalogId: this.catalogId,
                operations: sampleOperations(sample, surfaceId, this.catalogId),
                status: "ready",
                rejected: [],
              },
            });
          });
          emit({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          });
          observer.complete();
        },
        (error: unknown) => observer.error(error),
      );
    });
  }
}
