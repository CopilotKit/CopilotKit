import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
  BuiltInAgent,
} from "@copilotkit/runtime/v2";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import { handle } from "hono/vercel";
import OpenAI from "openai";
import {
  AbstractAgent,
  EventType,
  type RunAgentInput,
  type BaseEvent,
} from "@ag-ui/client";
import { Observable } from "rxjs";

const determineModel = () => {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return "openai/gpt-5.2";
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    // claude-3-7-sonnet supports extended thinking
    return "anthropic/claude-3-7-sonnet-20250219";
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return "google/gemini-2.5-pro";
  }
  return "openai/gpt-5.2";
};

const builtInAgent = new BuiltInAgent({
  model: determineModel(),
  prompt:
    "You are a helpful AI assistant. Use reasoning to answer the user's question. If you don't know the answer, say you don't know.",
  providerOptions: {
    openai: { reasoningEffort: "high", reasoningSummary: "detailed" },
    ...(!process.env.OPENAI_API_KEY?.trim() &&
      !!process.env.ANTHROPIC_API_KEY?.trim() && {
        anthropic: { thinking: { type: "enabled", budgetTokens: 5000 } },
      }),
  },
});

/**
 * Minimal demo agent for reproducing the A2UI thread-clone bug.
 *
 * First run  → emits an A2UI surface with a "Confirm" button.
 * Button click → runAgent fires again with forwardedProps.a2uiAction set,
 *                and the agent replies with a text message.
 *
 * Bug (before fix): the response appears on the registry agent's messages,
 * not the per-thread clone, so CopilotChat never re-renders.
 * Fix: useRenderActivityMessage now passes the clone to ReactSurfaceHost.
 */
class DemoButtonAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((observer) => {
      const emit = (event: BaseEvent) => observer.next(event);

      emit({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);

      const a2uiAction = (input.forwardedProps as Record<string, any>)
        ?.a2uiAction;

      if (a2uiAction) {
        // Button was clicked — respond with a text message.
        // Without the fix this message lands on the registry agent and never
        // shows in chat. With the fix it lands on the per-thread clone.
        const msgId = crypto.randomUUID();
        emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId: msgId,
          role: "assistant",
        } as BaseEvent);
        emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: msgId,
          delta: `✅ Confirmed! (thread: ${input.threadId}) — if you can read this, the fix is working.`,
        } as BaseEvent);
        emit({
          type: EventType.TEXT_MESSAGE_END,
          messageId: msgId,
        } as BaseEvent);
      } else {
        // First run — render an A2UI surface with a Confirm button.
        const activityId = crypto.randomUUID();
        emit({
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: activityId,
          activityType: "a2ui-surface",
          content: {
            operations: [
              {
                beginRendering: {
                  surfaceId: "demo-surface",
                  root: "container",
                },
              },
              {
                surfaceUpdate: {
                  surfaceId: "demo-surface",
                  components: [
                    {
                      id: "container",
                      component: {
                        Column: {
                          children: {
                            explicitList: ["prompt-text", "confirm-btn"],
                          },
                        },
                      },
                    },
                    {
                      id: "prompt-text",
                      component: {
                        Text: {
                          text: {
                            literalString:
                              "Click the button to trigger a response:",
                          },
                        },
                      },
                    },
                    {
                      id: "btn-label",
                      component: {
                        Text: { text: { literalString: "Confirm" } },
                      },
                    },
                    {
                      id: "confirm-btn",
                      component: {
                        Button: {
                          child: "btn-label",
                          action: { name: "confirm" },
                          primary: true,
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        } as BaseEvent);

        const msgId = crypto.randomUUID();
        emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId: msgId,
          role: "assistant",
        } as BaseEvent);
        emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: msgId,
          delta:
            "Click the button above. Without the fix, the confirmation message won't appear here.",
        } as BaseEvent);
        emit({
          type: EventType.TEXT_MESSAGE_END,
          messageId: msgId,
        } as BaseEvent);
      }

      emit({ type: EventType.RUN_FINISHED } as BaseEvent);
      observer.complete();
    });
  }

  clone(): AbstractAgent {
    return new DemoButtonAgent();
  }
}

// Set up transcription service if OpenAI API key is available
const transcriptionService = process.env.OPENAI_API_KEY?.trim()
  ? new TranscriptionServiceOpenAI({
      openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    })
  : undefined;

const honoRuntime = new CopilotRuntime({
  agents: {
    default: builtInAgent,
    "demo-button": new DemoButtonAgent(),
  },
  runner: new InMemoryAgentRunner(),
  transcriptionService,
  a2ui: {},
  openGenerativeUI: true,
});

const app = createCopilotEndpoint({
  runtime: honoRuntime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
