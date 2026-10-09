import { describe, expect, it } from "vitest";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { EMPTY } from "rxjs";
import "../activity-message-upsert";

/**
 * Stands in for any agent the frontend holds. `addMessage` is inherited from
 * `AbstractAgent`; this class adds no message storage of its own.
 */
class FakeAgent extends AbstractAgent {
  run(_input: RunAgentInput): Observable<BaseEvent> {
    return EMPTY;
  }
}

function activity(id: string, progress: number): Message {
  return {
    id,
    role: "activity",
    activityType: "job-progress",
    content: { progress },
  };
}

describe("activity message upsert (#7394)", () => {
  it("keeps only the latest revision after repeated same-id activity updates", () => {
    const agent = new FakeAgent();
    agent.addMessage({ id: "user-1", role: "user", content: "start the job" });

    for (let progress = 1; progress <= 100; progress++) {
      agent.addMessage(activity("job-1", progress));
    }

    agent.addMessage({
      id: "assistant-1",
      role: "assistant",
      content: "working",
    });

    expect(agent.messages).toHaveLength(3);
    expect(agent.messages.map((message) => message.role)).toEqual([
      "user",
      "activity",
      "assistant",
    ]);
    expect(agent.messages[1]).toMatchObject({
      id: "job-1",
      role: "activity",
      content: { progress: 100 },
    });
    expect(
      agent.messages.filter((message) => message.id === "job-1"),
    ).toHaveLength(1);
  });

  it("collapses activity revisions that were already stored under one id", () => {
    const agent = new FakeAgent();
    agent.setMessages([
      { id: "user-1", role: "user", content: "start" },
      activity("job-1", 10),
      activity("job-1", 20),
      activity("job-1", 30),
      { id: "user-2", role: "user", content: "still going" },
    ]);

    agent.addMessage(activity("job-1", 40));

    expect(agent.messages.map((message) => message.id)).toEqual([
      "user-1",
      "job-1",
      "user-2",
    ]);
    expect(agent.messages[1]).toMatchObject({ content: { progress: 40 } });
  });

  it("leaves user and assistant history append-only when ids repeat", () => {
    const agent = new FakeAgent();

    agent.addMessage({ id: "same", role: "user", content: "first" });
    agent.addMessage({ id: "same", role: "user", content: "second" });
    agent.addMessage({ id: "same", role: "assistant", content: "third" });
    agent.addMessage({ id: "same", role: "assistant", content: "fourth" });

    expect(agent.messages.map((message) => message.role)).toEqual([
      "user",
      "user",
      "assistant",
      "assistant",
    ]);
    expect(agent.messages.map((message) => message.content)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);
  });

  it("keeps distinct activity ids and does not replace a non-activity message", () => {
    const agent = new FakeAgent();
    agent.addMessage({ id: "shared", role: "user", content: "hello" });
    agent.addMessage(activity("shared", 1));
    agent.addMessage(activity("other-job", 1));
    agent.addMessage(activity("shared", 2));

    expect(agent.messages.map((message) => [message.role, message.id])).toEqual(
      [
        ["user", "shared"],
        ["activity", "shared"],
        ["activity", "other-job"],
      ],
    );
    expect(agent.messages[1]).toMatchObject({ content: { progress: 2 } });
    expect(agent.messages[0]).toMatchObject({
      role: "user",
      content: "hello",
    });
  });

  it("notifies subscribers with the bounded list", async () => {
    const agent = new FakeAgent();
    const lengths: number[] = [];
    agent.subscribe({
      onMessagesChanged: ({ messages }) => {
        lengths.push(messages.length);
      },
    });

    agent.addMessage(activity("job-1", 1));
    agent.addMessage(activity("job-1", 2));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(agent.messages).toHaveLength(1);
    expect(lengths.length).toBeGreaterThan(0);
    expect(lengths[lengths.length - 1]).toBe(1);
  });
});
