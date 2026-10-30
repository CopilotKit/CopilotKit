import assert from "node:assert/strict";
import test from "node:test";
import { HttpAgent } from "@ag-ui/client";
import type { RunAgentInput, UserMessage } from "@ag-ui/client";
import {
  REQUESTED_VIEW_METADATA_KEY,
  requestedView,
  ViewRequestSubmissions,
} from "./view-request-messages";

const user = (id: string): UserMessage => ({
  id,
  role: "user",
  content: "A question",
});

test("submit-time choices annotate only their new message, preserving other metadata", () => {
  const submissions = new ViewRequestSubmissions();
  const old = user("old");
  const first = { ...user("first"), metadata: { unrelated: { keep: true } } };
  submissions.begin("thread", "report", [old]);
  submissions.begin("thread", "table", [old]);
  const report = submissions.annotate([old, first], "thread")!;
  assert.equal(report[0], old);
  assert.equal(requestedView(report[1])?.id, "report");
  assert.deepEqual(report[1].metadata, {
    unrelated: { keep: true },
    [REQUESTED_VIEW_METADATA_KEY]: "report",
  });
  assert.deepEqual(first.metadata, { unrelated: { keep: true } });
  // A tool continuation can run before the second queued question is added.
  assert.equal(submissions.annotate(report, "thread"), undefined);
  const table = submissions.annotate([...report, user("second")], "thread")!;
  assert.equal(requestedView(table[1])?.id, "report");
  assert.equal(requestedView(table[2])?.id, "table");
});

test("the next plain message and a cancelled selection stay unmarked", () => {
  const submissions = new ViewRequestSubmissions();
  submissions.begin("thread", "report", []);
  const report = submissions.annotate([user("first")], "thread")!;
  submissions.begin("thread", null, report);
  assert.equal(
    submissions.annotate([...report, user("plain")], "thread"),
    undefined,
  );
  assert.equal(
    submissions.annotate([...report, user("another")], "thread"),
    undefined,
  );
});

test("a rejected submission cannot annotate the next message", () => {
  const submissions = new ViewRequestSubmissions();
  const rejected = submissions.begin("thread", "report", []);
  submissions.finish(rejected);
  submissions.begin("thread", "table", []);
  const messages = submissions.annotate([user("accepted")], "thread")!;
  assert.equal(requestedView(messages[0])?.id, "table");
});

test("replay and another thread cannot consume a pending selection", () => {
  const submissions = new ViewRequestSubmissions();
  const old = user("old");
  submissions.begin("current", "report", [old]);
  assert.equal(submissions.annotate([old], "current"), undefined);
  assert.equal(submissions.annotate([user("elsewhere")], "other"), undefined);
  const messages = submissions.annotate([old, user("new")], "current")!;
  assert.equal(requestedView(messages[1])?.id, "report");
});

test("switching threads discards unsent associations", () => {
  const submissions = new ViewRequestSubmissions();
  submissions.begin("old-thread", "report", []);
  submissions.clear();
  submissions.begin("new-thread", null, []);
  assert.equal(
    submissions.annotate([user("restored")], "old-thread"),
    undefined,
  );
  assert.equal(submissions.annotate([user("new")], "new-thread"), undefined);
});

test("serialized history restores known catalog markers without interpreting prose", () => {
  const submissions = new ViewRequestSubmissions();
  submissions.begin("thread", "report", []);
  const saved = JSON.stringify(
    submissions.annotate([user("question")], "thread"),
  );
  assert.equal(requestedView(JSON.parse(saved)[0])?.id, "report");
  assert.equal(
    requestedView({ metadata: { [REQUESTED_VIEW_METADATA_KEY]: "unknown" } }),
    undefined,
  );
  assert.equal(requestedView({}), undefined);
});

test("the SDK subscriber mutation reaches wire input and survives a history snapshot", async () => {
  const submissions = new ViewRequestSubmissions();
  let sent: RunAgentInput | undefined;
  const agent = new HttpAgent({
    url: "https://example.test/agent",
    threadId: "thread",
    fetch: async (_url, init) => {
      const input = JSON.parse(String(init?.body)) as RunAgentInput;
      sent = input;
      const events = [
        { type: "RUN_STARTED", threadId: input.threadId, runId: input.runId },
        { type: "MESSAGES_SNAPSHOT", messages: input.messages },
        { type: "RUN_FINISHED", threadId: input.threadId, runId: input.runId },
      ];
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        {
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    },
  });
  agent.subscribe({
    onRunInitialized: ({ messages, input }) => {
      const annotated = submissions.annotate(messages, input.threadId);
      if (annotated) return { messages: annotated };
    },
  });
  submissions.begin("thread", "report", agent.messages);
  agent.addMessage(user("sent-question"));
  await agent.runAgent();
  assert.equal(requestedView(sent!.messages[0])?.id, "report");
  assert.equal(requestedView(agent.messages[0])?.id, "report");
});
