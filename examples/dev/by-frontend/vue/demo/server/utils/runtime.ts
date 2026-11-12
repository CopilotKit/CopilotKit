import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import { CopilotRuntime, InMemoryAgentRunner } from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/agent";
import { anthropicText } from "@tanstack/ai-anthropic";
import { geminiText } from "@tanstack/ai-gemini";
import { openaiText } from "@tanstack/ai-openai";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import { PRODUCTS } from "../../generative-ui/products";

const determineModel = () => {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return openaiText("gpt-6-luna");
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return anthropicText("claude-sonnet-4-6");
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return geminiText("gemini-3.8-flash");
  }
  // No key found: the OpenAI adapter throws an error that names OPENAI_API_KEY.
  return openaiText("gpt-6-luna");
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
 * First run  → emits an A2UI v0.9 surface with a "Confirm" button. The
 *              runtime converts it to A2UI 1.0 for the client.
 * Button click → runAgent fires again; the runtime turns the click on the
 *                converted surface into forwardedProps.a2uiAction, and the
 *                agent replies with a confirmation text message.
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
            // Canonical A2UI v0.9 content key + operation format (matches
            // @ag-ui/a2ui-middleware and the Python SDK). The root component
            // must have id "root".
            a2ui_operations: [
              {
                version: "v0.9",
                createSurface: {
                  surfaceId: "demo-surface",
                  catalogId:
                    "https://a2ui.org/specification/v0_9/basic_catalog.json",
                },
              },
              {
                version: "v0.9",
                updateComponents: {
                  surfaceId: "demo-surface",
                  components: [
                    {
                      id: "root",
                      component: "Column",
                      children: ["prompt-text", "confirm-btn"],
                    },
                    {
                      id: "prompt-text",
                      component: "Text",
                      text: "Click the button to trigger a response:",
                      variant: "body",
                    },
                    {
                      id: "btn-label",
                      component: "Text",
                      text: "Confirm",
                    },
                    {
                      id: "confirm-btn",
                      component: "Button",
                      child: "btn-label",
                      variant: "primary",
                      action: { event: { name: "confirm" } },
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
      default: new BuiltInAgent({
        model: determineModel(),
        prompt: "You are a helpful AI assistant.",
      }),
      "demo-button": new DemoButtonAgent(),
    },
    runner: new InMemoryAgentRunner(),
    transcriptionService: createTranscriptionService(),
    // Generative UI on every run; the demo-button agent speaks A2UI v0.9.
    generativeUI: { a2uiVersion: { "demo-button": "0.9" } },
  });

/**
 * Catalog-on-provider runtime: same DemoButtonAgent, but the runtime has NO
 * `generativeUI` config. Generative UI is meant to switch on purely from the
 * client passing a UI to the provider (which sends its catalog with each
 * run). Used by `/a2ui-catalog` to validate that path in isolation.
 */
export const createCatalogOnlyRuntime = () =>
  new CopilotRuntime({
    agents: {
      "demo-button": new DemoButtonAgent(),
    },
    runner: new InMemoryAgentRunner(),
  });

/**
 * Runtime of the `/generative-ui` store page. `generativeUI: true` gives the
 * agent the `render_ui` tool on every run, built from the catalog that the
 * page sends. Mirrors `src/app/api/copilotkit-generative-ui` of the React
 * demo.
 */
export const createGenerativeUIRuntime = () =>
  new CopilotRuntime({
    agents: {
      default: new BuiltInAgent({
        model: determineModel(),
        prompt: `You are the shopping assistant for Acme Audio.
Catalog (the only products that exist): ${JSON.stringify(PRODUCTS)}

Use the render_ui tool for UI:
- Show product recommendations as a ProductGrid root plus one ProductCard per product. Send the root first with every card id already in its children, then each card in its own operation.
- ProductCard props are exactly productId, name, price, tagline; set productId to the product's id; never add other props (no category).
- To refine recommendations later, update the existing surface instead of creating a new one.
Keep text replies short; let the UI carry the details.`,
      }),
    },
    runner: new InMemoryAgentRunner(),
    generativeUI: true,
  });

/**
 * Runtime of the `/generative-ui-standard` page. The page sends the standard
 * catalog, and `generativeUI: true` gives the agent the `render_ui` tool for
 * it. The agent renders into the chat.
 */
export const createStandardCatalogRuntime = () =>
  new CopilotRuntime({
    agents: {
      default: new BuiltInAgent({
        model: determineModel(),
        prompt: `You are a helpful assistant in a chat. Answer with UI from the standard catalog by calling the render_ui tool, for example a Card with a Title, Text, Badge, Table, Chart, List, Tabs or a Form with inputs and a Button. Render into the chat. Keep text replies to one short sentence and let the UI carry the details.`,
      }),
    },
    runner: new InMemoryAgentRunner(),
    generativeUI: true,
  });

export const createMcpRuntime = () => {
  const agent = new BuiltInAgent({
    model: determineModel(),
    prompt: "You are a helpful AI assistant with access to MCP apps and tools.",
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
