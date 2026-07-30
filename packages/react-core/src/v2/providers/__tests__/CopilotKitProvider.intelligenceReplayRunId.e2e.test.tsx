import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { BaseEvent, Message } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import { IntelligenceAgent } from "@copilotkit/core";
import { renderWithCopilotKit } from "../../__tests__/utils/test-helpers";
import type { ReactCustomMessageRenderer } from "../../types/react-custom-message-renderer";
import type {
  MockChannel,
  MockSocket,
} from "../../../../../core/src/__tests__/test-utils";

const socketInstances = vi.hoisted(() => [] as MockSocket[]);

vi.mock("phoenix", async () => {
  const { MockSocket: TestSocket } =
    await import("../../../../../core/src/__tests__/test-utils");

  return {
    Socket: class extends TestSocket {
      constructor(url: string, options: Record<string, unknown>) {
        super(url, options);
        socketInstances.push(this);
      }
    },
  };
});

afterEach(() => {
  socketInstances.length = 0;
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

type ReplayRendererProps = React.ComponentProps<
  NonNullable<ReactCustomMessageRenderer["render"]>
>;

function ReplayRenderer({
  message,
  position,
  runId,
  messageIndexInRun,
  numberOfMessagesInRun,
  stateSnapshot,
}: ReplayRendererProps): React.ReactElement | null {
  if (position !== "after" || message.role !== "assistant") {
    return null;
  }

  return (
    <div
      data-testid={`replay-${message.id}`}
      data-run-id={runId}
      data-message-index-in-run={messageIndexInRun}
      data-messages-in-run={numberOfMessagesInRun}
    >
      State: {(stateSnapshot as { turn?: number } | undefined)?.turn ?? "none"}
    </div>
  );
}

describe("CopilotKitProvider Intelligence replay run identity", () => {
  it("renders cumulative replay messages with their server run IDs and state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          threadId: "test-thread",
          runId: null,
          joinToken: "join-token",
          realtime: {
            clientUrl: "ws://localhost:4401/client",
            topic: "thread:test-thread",
          },
        }),
      ),
    );

    const agent = new IntelligenceAgent({
      url: "ws://localhost:4401/client",
      runtimeUrl: "http://localhost:4000",
      agentId: "default",
    });
    agent.threadId = "test-thread";

    renderWithCopilotKit({
      agent,
      renderCustomMessages: [{ render: ReplayRenderer }],
    });

    let channel: MockChannel | undefined;
    await waitFor(() => {
      channel = socketInstances.at(-1)?.channels.at(-1);
      expect(channel).toBeDefined();
    });
    channel!.triggerJoin("ok");

    const firstMessage: Message = {
      id: "message-1",
      role: "assistant",
      content: "First response",
    };
    const secondMessage: Message = {
      id: "message-2",
      role: "assistant",
      content: "Second response",
    };

    channel!.serverPush("ag_ui_event", {
      type: EventType.RUN_STARTED,
      threadId: "test-thread",
      run_id: "server-run-1",
      input: { messages: [] },
    } as BaseEvent);
    channel!.serverPush("ag_ui_event", {
      type: EventType.STATE_SNAPSHOT,
      snapshot: { turn: 1 },
    } as BaseEvent);
    channel!.serverPush("ag_ui_event", {
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [firstMessage],
    } as BaseEvent);
    channel!.serverPush("ag_ui_event", {
      type: EventType.RUN_FINISHED,
      threadId: "test-thread",
      run_id: "server-run-1",
    } as BaseEvent);

    channel!.serverPush("ag_ui_event", {
      type: EventType.RUN_STARTED,
      threadId: "test-thread",
      run_id: "server-run-2",
      input: { messages: [firstMessage] },
    } as BaseEvent);
    channel!.serverPush("ag_ui_event", {
      type: EventType.STATE_SNAPSHOT,
      snapshot: { turn: 2 },
    } as BaseEvent);
    channel!.serverPush("ag_ui_event", {
      type: EventType.MESSAGES_SNAPSHOT,
      messages: [firstMessage, secondMessage],
    } as BaseEvent);
    channel!.serverPush("ag_ui_event", {
      type: EventType.RUN_FINISHED,
      threadId: "test-thread",
      run_id: "server-run-2",
    } as BaseEvent);
    channel!.serverPush("replay_complete", { latestEventId: "event-8" });
    channel!.serverPush("stream_idle", { latestEventId: "event-8" });

    const firstRendered = await screen.findByTestId("replay-message-1");
    const secondRendered = await screen.findByTestId("replay-message-2");

    expect(firstRendered.getAttribute("data-run-id")).toBe("server-run-1");
    expect(firstRendered.getAttribute("data-message-index-in-run")).toBe("0");
    expect(firstRendered.getAttribute("data-messages-in-run")).toBe("1");
    expect(firstRendered.textContent).toBe("State: 1");

    expect(secondRendered.getAttribute("data-run-id")).toBe("server-run-2");
    expect(secondRendered.getAttribute("data-message-index-in-run")).toBe("0");
    expect(secondRendered.getAttribute("data-messages-in-run")).toBe("1");
    expect(secondRendered.textContent).toBe("State: 2");
  });
});
