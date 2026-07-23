import { describe, it, expect } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { TeamsConversationStore } from "./conversation-store.js";

/** Minimal stand-in: only the `messages` field the store writes is exercised. */
function makeAgent(threadId: string): AbstractAgent {
  return { threadId, messages: [] } as unknown as AbstractAgent;
}

describe("TeamsConversationStore", () => {
  it("seeds a fresh agent with the accumulated transcript", async () => {
    const store = new TeamsConversationStore();
    store.recordUser("conv-1", "hello");
    store.recordAssistant("conv-1", "hi there");
    store.recordUser("conv-1", "how are you?");

    const session = await store.getOrCreate("conv-1", {}, makeAgent);
    const messages = (session.agent as unknown as { messages: unknown[] })
      .messages;

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "hello" }),
      expect.objectContaining({ role: "assistant", content: "hi there" }),
      expect.objectContaining({ role: "user", content: "how are you?" }),
    ]);
  });

  it("isolates transcripts by conversation key", async () => {
    const store = new TeamsConversationStore();
    store.recordUser("a", "from a");
    store.recordUser("b", "from b");

    const a = await store.getOrCreate("a", {}, makeAgent);
    const aMessages = (a.agent as unknown as { messages: unknown[] }).messages;
    expect(aMessages).toHaveLength(1);
    expect(aMessages[0]).toMatchObject({ content: "from a" });
  });

  it("exposes the transcript as bot-ui ThreadMessages", () => {
    const store = new TeamsConversationStore();
    store.recordUser("c", "ping");
    store.recordAssistant("c", "pong");
    expect(store.getTranscript("c")).toEqual([
      { text: "ping", isBot: false },
      { text: "pong", isBot: true },
    ]);
  });

  it("ignores empty messages", () => {
    const store = new TeamsConversationStore();
    store.recordUser("d", "");
    store.recordUser("d", []); // empty content parts are dropped too
    store.recordAssistant("d", "   "); // whitespace-only is still stored as-is by callers; empty string is dropped
    expect(store.getTranscript("d")).toEqual([{ text: "   ", isBot: true }]);
  });

  it("persists multimodal content so a later turn still sees uploaded data", async () => {
    const store = new TeamsConversationStore();
    // Turn 1: a CSV upload, recorded as multimodal content parts.
    store.recordUser("conv-1", [
      { type: "text", text: "make a pie chart" },
      { type: "text", text: 'Attached file "data.csv" (text/csv):\na,b\n1,2' },
    ]);
    store.recordAssistant("conv-1", "Pie chart created.");
    // Turn 2: a plain follow-up with no new data.
    store.recordUser("conv-1", "now make it a bar chart");

    const session = await store.getOrCreate("conv-1", {}, makeAgent);
    const messages = (session.agent as unknown as { messages: unknown[] })
      .messages;

    // The CSV content from turn 1 is still seeded into the agent on turn 2.
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "make a pie chart" },
        expect.objectContaining({ type: "text" }),
      ],
    });
    // The transcript view flattens parts to text (for thread.getMessages()).
    expect(store.getTranscript("conv-1")[0]!.text).toContain("a,b\n1,2");
  });
});
