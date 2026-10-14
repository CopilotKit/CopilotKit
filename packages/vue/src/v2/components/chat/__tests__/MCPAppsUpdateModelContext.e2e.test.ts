/**
 * Vue counterpart of react-core's `MCPAppsUpdateModelContext.e2e.test.tsx`:
 * the widget's ui/update-model-context goes through the shared session to the
 * core, and the next run of the conversation carries it.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import {
  activitySnapshotEvent,
  runFinishedEvent,
  runStartedEvent,
  testId,
} from "../../../__tests__/utils/test-helpers";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput, RunAgentResult } from "@ag-ui/client";
import { Observable, Subject } from "rxjs";
import { MCPAppsActivityType } from "../../MCPAppsActivityRenderer";
import CopilotChat from "../CopilotChat.vue";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";

/**
 * Records every run's input and answers the widget's resources/read. Each run
 * gets its own event stream, completed by `finishRun()`, so the chat sees the
 * run end and accepts the next message.
 */
class MockMCPProxyAgent extends AbstractAgent {
  private current = new Subject<BaseEvent>();
  private buffered: BaseEvent[] = [];
  public runInputs: RunAgentInput[] = [];

  async emit(event: BaseEvent): Promise<void> {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    if (this.current.observers.length === 0) this.buffered.push(event);
    else this.current.next(event);
    await flushVueUpdates();
  }

  async finishRun(): Promise<void> {
    await this.emit(runFinishedEvent());
    this.current.complete();
    await flushVueUpdates();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.runInputs.push(input);
    const subject = new Subject<BaseEvent>();
    this.current = subject;
    return new Observable<BaseEvent>((observer) => {
      for (const event of this.buffered) observer.next(event);
      this.buffered = [];
      const subscription = subject.subscribe(observer);
      return () => subscription.unsubscribe();
    });
  }

  async runAgent(input?: Partial<RunAgentInput>): Promise<RunAgentResult> {
    const proxiedRequest = input?.forwardedProps?.__proxiedMCPRequest as
      | { method: string; params?: Record<string, unknown> }
      | undefined;
    if (proxiedRequest?.method === "resources/read") {
      return {
        result: {
          contents: [
            {
              uri: proxiedRequest.params?.uri,
              mimeType: "text/html",
              text: "<html><body>Stations</body></html>",
            },
          ],
        },
        newMessages: [],
      };
    }
    if (proxiedRequest) return { result: {}, newMessages: [] };
    return super.runAgent(input);
  }
}

async function flushVueUpdates(): Promise<void> {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function sendUserMessage(text: string) {
  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, text);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(screen.getByText(text)).toBeDefined());
}

async function setupMCPActivity(agent: MockMCPProxyAgent) {
  const agentId = agent.agentId!;
  const threadId = testId("umc-thread");
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      CopilotChat,
    },
    setup() {
      return { agentId, threadId, agents: { [agentId]: agent } };
    },
    template: `
      <CopilotKitProvider runtimeUrl="/api/copilotkit" :agents__unsafe_dev_only="agents">
        <CopilotChatConfigurationProvider :thread-id="threadId" :agent-id="agentId">
          <div style="height: 400px;">
            <CopilotChat :welcome-screen="false" />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });
  render(Host);

  await sendUserMessage("Show me the stations");
  await agent.emit(runStartedEvent());
  await agent.emit(
    activitySnapshotEvent({
      messageId: testId("mcp-activity"),
      activityType: MCPAppsActivityType,
      content: {
        resourceUri: "ui://trains/stations",
        serverHash: "trains-hash",
        toolInput: {},
        result: { content: [{ type: "text", text: "ok" }], isError: false },
      },
    }),
  );
  await agent.finishRun();

  let iframe: HTMLIFrameElement | null = null;
  await waitFor(
    () => {
      iframe = document.querySelector("iframe[srcdoc]");
      expect(iframe).not.toBeNull();
    },
    { timeout: 3000 },
  );
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready" },
      source: iframe!.contentWindow,
      origin: "",
    }),
  );
  await flushVueUpdates();
  await new Promise((resolve) => setTimeout(resolve, 100));
  return iframe!;
}

/** Send a JSON-RPC request from the widget and return the host's response. */
async function request(
  iframe: HTMLIFrameElement,
  method: string,
  params: Record<string, unknown>,
) {
  const id = testId("req");
  const responses: any[] = [];
  const spy = vi
    .spyOn(iframe.contentWindow as Window, "postMessage")
    .mockImplementation((message: any) => {
      if (message?.id === id) responses.push(message);
    });
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { jsonrpc: "2.0", id, method, params },
      source: iframe.contentWindow,
      origin: "",
    }),
  );
  await flushVueUpdates();
  await new Promise((resolve) => setTimeout(resolve, 100));
  spy.mockRestore();
  return responses[0];
}

const SELECTION = {
  content: [{ type: "text", text: "The user looks at Lyon." }],
  structuredContent: { stationId: "lyon", filter: "available" },
};

const widgetEntry = (input: RunAgentInput | undefined) =>
  input?.context.find((entry) => entry.description.includes("ui://trains"));

describe("MCP Apps ui/update-model-context (Vue)", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("announces updateModelContext at initialize", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = testId("umc-capability");
    const iframe = await setupMCPActivity(agent);

    const response = await request(iframe, "ui/initialize", {
      appInfo: { name: "stations", version: "1.0.0" },
      appCapabilities: {},
      protocolVersion: "2026-01-26",
    });

    expect(response.result.hostCapabilities.updateModelContext).toEqual({
      text: {},
      structuredContent: {},
    });
  });

  it("sends the widget's latest state with the next user message, without a message or a run of its own", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = testId("umc-next-run");
    const iframe = await setupMCPActivity(agent);
    const runsBefore = agent.runInputs.length;
    const messagesBefore = agent.messages.length;

    await request(iframe, "ui/update-model-context", {
      structuredContent: { stationId: "paris" },
    });
    const response = await request(
      iframe,
      "ui/update-model-context",
      SELECTION,
    );

    expect(response.result).toEqual({});
    expect(agent.runInputs.length).toBe(runsBefore);
    expect(agent.messages.length).toBe(messagesBefore);

    await sendUserMessage("Which departures are available?");
    await waitFor(() =>
      expect(agent.runInputs.length).toBeGreaterThan(runsBefore),
    );

    const entry = widgetEntry(agent.runInputs.at(-1));
    expect(JSON.parse(entry!.value as string)).toEqual({
      text: ["The user looks at Lyon."],
      structuredContent: { filter: "available", stationId: "lyon" },
    });
    expect(
      agent.runInputs
        .at(-1)!
        .context.filter((item) => item.description.includes("ui://trains")),
    ).toHaveLength(1);
  });
});
