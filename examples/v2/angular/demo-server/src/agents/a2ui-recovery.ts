import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";

const MAX_ATTEMPTS = 3;

const VALIDATION_ERRORS = [
  {
    code: "unknown_component_reference",
    path: "components[1].children[1]",
    message: 'Row "kpis" references "churn", which is not defined.',
  },
];

function surfaceOperations(): unknown[] {
  const surfaceId = "signups";
  return [
    {
      version: "v0.9",
      createSurface: {
        surfaceId,
        catalogId: "copilotkit://angular-dashboard-catalog",
      },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [
          {
            id: "root",
            component: "Card",
            title: "Weekly signups",
            subtitle: "Recovered on attempt 2",
            child: "kpis",
          },
          { id: "kpis", component: "Row", children: ["signups", "churn"] },
          {
            id: "signups",
            component: "Metric",
            label: "Signups",
            value: "1,284",
            trend: "up",
            trendValue: "+8%",
          },
          {
            id: "churn",
            component: "Metric",
            label: "Churn",
            value: "2.1%",
            trend: "down",
            trendValue: "-0.4%",
          },
        ],
      },
    },
  ];
}

type Step = { delayMs: number; content?: unknown; text?: string };

/** Building with growing token counts, then a rejected attempt. */
function failedAttempt(attempt: number): Step[] {
  return [
    { delayMs: 300, content: { status: "building", progressTokens: 40 } },
    { delayMs: 500, content: { status: "building", progressTokens: 160 } },
    { delayMs: 500, content: { status: "building", progressTokens: 320 } },
    {
      delayMs: 600,
      content: {
        status: "retrying",
        attempt: attempt + 1,
        maxAttempts: MAX_ATTEMPTS,
        errors: VALIDATION_ERRORS,
      },
    },
  ];
}

const HEAL: Step[] = [
  ...failedAttempt(1),
  { delayMs: 2000, content: { status: "building", progressTokens: 180 } },
  { delayMs: 600, content: { a2ui_operations: surfaceOperations() } },
  {
    delayMs: 200,
    text: "The first attempt failed validation; the retry rendered.",
  },
];

const EXHAUST: Step[] = [
  ...failedAttempt(1),
  ...failedAttempt(2).map((step, index) =>
    index === 0 ? { ...step, delayMs: 2000 } : step,
  ),
  {
    delayMs: 1500,
    content: {
      status: "failed",
      error: `A2UI generation failed after ${MAX_ATTEMPTS} attempts.`,
      maxAttempts: MAX_ATTEMPTS,
      attempts: [1, 2, 3].map((attempt) => ({
        attempt,
        errors: VALIDATION_ERRORS,
      })),
    },
  },
  { delayMs: 200, text: "Every attempt failed validation, so I stopped." },
];

function lastUserText(input: RunAgentInput): string {
  const message = [...input.messages]
    .toReversed()
    .find((m) => m.role === "user");
  return typeof message?.content === "string" ? message.content : "";
}

/**
 * Scripted agent for the A2UI recovery demo; no LLM needed. It replays the
 * activity lifecycle the A2UI middleware emits while it validates and
 * retries a generated surface: one stable activity message updated from
 * `building` to `retrying` and then to the painted surface ("heal"), or to
 * `failed` once the attempts run out (a message containing "fail").
 */
export class A2UIRecoveryAgent extends AbstractAgent {
  clone(): A2UIRecoveryAgent {
    return new A2UIRecoveryAgent();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((observer) => {
      const emit = (event: Record<string, unknown>) =>
        observer.next(event as BaseEvent);
      const steps = /fail/i.test(lastUserText(input)) ? EXHAUST : HEAL;
      const activityId = `a2ui-surface-${input.runId}`;
      let timer: ReturnType<typeof setTimeout> | undefined;

      emit({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });

      const play = (index: number) => {
        const step = steps[index];
        if (!step) {
          emit({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          });
          observer.complete();
          return;
        }
        timer = setTimeout(() => {
          if (step.content) {
            emit({
              type: EventType.ACTIVITY_SNAPSHOT,
              messageId: activityId,
              activityType: "a2ui-surface",
              content: step.content,
              replace: true,
            });
          }
          if (step.text) {
            const messageId = crypto.randomUUID();
            emit({
              type: EventType.TEXT_MESSAGE_START,
              messageId,
              role: "assistant",
            });
            emit({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId,
              delta: step.text,
            });
            emit({ type: EventType.TEXT_MESSAGE_END, messageId });
          }
          play(index + 1);
        }, step.delayMs);
      };
      play(0);

      return () => clearTimeout(timer);
    });
  }
}
