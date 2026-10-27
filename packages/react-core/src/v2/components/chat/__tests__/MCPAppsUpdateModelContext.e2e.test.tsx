/**
 * ui/update-model-context through the React chat: a widget reports its state,
 * nothing is added to the chat and no run starts, and the next run of the
 * conversation (a user message, or the widget's own ui/message follow-up)
 * carries that state in `RunAgentInput.context`.
 */
import { fireEvent, screen, waitFor, act } from "@testing-library/react";
import { vi } from "vitest";
import {
  activitySnapshotEvent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  testId,
} from "../../../__tests__/utils/test-helpers";
import { MCPAppsActivityType } from "../../../components/MCPAppsActivityRenderer";
import type { RunAgentInput, RunAgentResult, BaseEvent } from "@ag-ui/client";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { Subject } from "rxjs";

/**
 * Records every run's input and answers the widget's resources/read. Each run
 * gets its own event stream, completed by `finishRun()`, so the chat sees the
 * run end and accepts the next message.
 */
class MockMCPProxyAgent extends AbstractAgent {
  private current = new Subject<BaseEvent>();
  public runInputs: RunAgentInput[] = [];

  emit(event: BaseEvent) {
    if (event.type === EventType.RUN_STARTED) {
      this.isRunning = true;
    } else if (
      event.type === EventType.RUN_FINISHED ||
      event.type === EventType.RUN_ERROR
    ) {
      this.isRunning = false;
    }
    act(() => {
      this.current.next(event);
    });
  }

  finishRun() {
    this.emit(runFinishedEvent());
    act(() => {
      this.current.complete();
    });
  }

  async detachActiveRun(): Promise<void> {}

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.runInputs.push(input);
    this.current = new Subject<BaseEvent>();
    return this.current.asObservable();
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

async function setupMCPActivity(agent: MockMCPProxyAgent) {
  const agentId = agent.agentId!;
  renderWithCopilotKit({
    agents: { [agentId]: agent },
    agentId,
    threadId: testId("thread"),
  });

  await sendUserMessage("Show me the stations");
  agent.emit(runStartedEvent());
  agent.emit(
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
  agent.finishRun();

  let iframe: HTMLIFrameElement | null = null;
  await waitFor(
    () => {
      iframe = document.querySelector("iframe[srcdoc]");
      expect(iframe).not.toBeNull();
    },
    { timeout: 3000 },
  );
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          jsonrpc: "2.0",
          method: "ui/notifications/sandbox-proxy-ready",
        },
        source: iframe!.contentWindow,
        origin: "",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  return iframe!;
}

async function sendUserMessage(text: string) {
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(screen.getByText(text)).toBeDefined());
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
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { jsonrpc: "2.0", id, method, params },
        source: iframe.contentWindow,
        origin: "",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  spy.mockRestore();
  return responses[0];
}

const SELECTION = {
  content: [{ type: "text", text: "The user looks at Lyon." }],
  structuredContent: { stationId: "lyon", filter: "available" },
};

/** The context entry the widget's state produced, from a run's input. */
const widgetEntry = (input: RunAgentInput | undefined) =>
  input?.context.find((entry) => entry.description.includes("ui://trains"));

describe("MCP Apps ui/update-model-context", () => {
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
    // Only the latest state: one entry for the widget.
    expect(
      agent.runInputs
        .at(-1)!
        .context.filter((item) => item.description.includes("ui://trains")),
    ).toHaveLength(1);
  });

  it("carries the state into the widget's ui/message follow-up, even once the widget is gone and the follow-up waited in the queue", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = testId("umc-follow-up");
    const iframe = await setupMCPActivity(agent);
    await request(iframe, "ui/update-model-context", SELECTION);

    // The agent is busy, so the follow-up waits in the queue.
    agent.isRunning = true;
    await request(iframe, "ui/message", {
      role: "user",
      content: [{ type: "text", text: "Which departures are available?" }],
    });
    const runsBefore = agent.runInputs.length;

    // The widget leaves the chat before the queue drains.
    act(() => {
      agent.setMessages(
        agent.messages.filter((message) => message.role !== "activity"),
      );
    });
    await waitFor(() =>
      expect(document.querySelector("iframe[srcdoc]")).toBeNull(),
    );

    agent.isRunning = false;
    await waitFor(
      () => expect(agent.runInputs.length).toBeGreaterThan(runsBefore),
      { timeout: 3000 },
    );

    expect(widgetEntry(agent.runInputs.at(-1))).toBeDefined();
  });

  it("refuses an image block and keeps the previous state", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = testId("umc-refused");
    const iframe = await setupMCPActivity(agent);
    await request(iframe, "ui/update-model-context", SELECTION);

    const response = await request(iframe, "ui/update-model-context", {
      content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
    });
    expect(response.error).toBeDefined();

    const runsBefore = agent.runInputs.length;
    await sendUserMessage("Still Lyon?");
    await waitFor(() =>
      expect(agent.runInputs.length).toBeGreaterThan(runsBefore),
    );
    expect(widgetEntry(agent.runInputs.at(-1))?.value).toContain("lyon");
  });

  it("refuses an update once the shared agent moved to another conversation", async () => {
    const agent = new MockMCPProxyAgent();
    agent.agentId = testId("umc-thread");
    const iframe = await setupMCPActivity(agent);

    agent.threadId = testId("other-thread");
    const refused = await request(iframe, "ui/update-model-context", SELECTION);

    // Thread scoping of what was stored is covered in @copilotkit/core; here
    // the stale iframe cannot even store into the new conversation.
    expect(refused.error.message).toContain("no longer the current one");
  });
});
