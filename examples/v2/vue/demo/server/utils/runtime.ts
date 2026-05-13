import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import {
  BasicAgent,
  CopilotRuntime,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";

const determineModel = () => {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return "openai/gpt-4o";
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return "anthropic/claude-sonnet-4.5";
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return "google/gemini-2.5-pro";
  }
  return "openai/gpt-4o";
};

const createTranscriptionService = () => {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return undefined;
  }
  return new TranscriptionServiceOpenAI({
    openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  });
};

/**
 * Minimal demo agent that drives the `/a2ui-demo` route.
 *
 * First run  → emits an A2UI surface with a "Confirm" button.
 * Button click → runAgent fires again with forwardedProps.a2uiAction set,
 *                and the agent replies with a confirmation text message.
 *
 * Mirrors `DemoButtonAgent` in the React demo's
 * `src/app/api/copilotkit/[[...slug]]/route.ts`.
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

      const a2uiAction = (input.forwardedProps as Record<string, unknown>)
        ?.a2uiAction;

      if (a2uiAction) {
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

export const createDefaultRuntime = () =>
  new CopilotRuntime({
    agents: {
      default: new BasicAgent({
        model: determineModel(),
        prompt: "You are a helpful AI assistant.",
        temperature: 0.7,
      }),
      "demo-button": new DemoButtonAgent(),
    },
    runner: new InMemoryAgentRunner(),
    transcriptionService: createTranscriptionService(),
    a2ui: {},
  });

export const createMcpRuntime = () => {
  const agent = new BasicAgent({
    model: determineModel(),
    prompt: "You are a helpful AI assistant with access to MCP apps and tools.",
    temperature: 0.7,
  }).use(
    new MCPAppsMiddleware({
      mcpServers: [
        { type: "http", url: "http://localhost:3101/mcp" },
        { type: "http", url: "http://localhost:3102/mcp" },
        { type: "http", url: "http://localhost:3103/mcp" },
        { type: "http", url: "http://localhost:3104/mcp" },
        { type: "http", url: "http://localhost:3105/mcp" },
        { type: "http", url: "http://localhost:3106/mcp" },
        { type: "http", url: "http://localhost:3107/mcp" },
        { type: "http", url: "http://localhost:3108/mcp" },
        { type: "http", url: "http://localhost:3109/mcp" },
        { type: "http", url: "http://localhost:3110/mcp" },
        { type: "http", url: "http://localhost:3111/mcp" },
        { type: "http", url: "http://localhost:3112/mcp" },
      ],
    }),
  );

  return new CopilotRuntime({
    agents: { default: agent },
    runner: new InMemoryAgentRunner(),
  });
};
