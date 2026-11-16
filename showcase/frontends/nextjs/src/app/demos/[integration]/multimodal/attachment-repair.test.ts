import { AbstractAgent, EventType } from "@ag-ui/client";
import type { ContentPart, Message } from "@ag-ui/core";
import { EMPTY } from "rxjs";
import { describe, expect, it } from "vitest";
import { attachmentRepair } from "./attachment-repair";

// An agent that never streams. The subscriber only needs one to exist.
class IdleAgent extends AbstractAgent {
  run() {
    return EMPTY;
  }
}

const TEXT: ContentPart = { type: "text", text: "What is in this file?" };
const PNG: ContentPart = {
  type: "image",
  source: { type: "data", value: "iVBORw0K", mimeType: "image/png" },
};
const ASSISTANT: Message = {
  id: "assistant-1",
  role: "assistant",
  content: "It is the CopilotKit logo.",
};

function userMessage(content: string | ContentPart[]): Message {
  return { id: "user-1", role: "user", content };
}

// What the agent passes each subscriber, for an agent that holds `messages`.
function subscriberParams(messages: Message[]) {
  return {
    messages,
    state: {},
    agent: new IdleAgent(),
    input: {
      threadId: "thread-1",
      runId: "run-1",
      messages,
      tools: [],
      context: [],
    },
  };
}

function onRunFinalized(messages: Message[]) {
  return attachmentRepair.onRunFinalized(subscriberParams(messages));
}

function onSnapshot(current: Message[], snapshot: Message[]) {
  return attachmentRepair.onMessagesSnapshotEvent({
    ...subscriberParams(current),
    event: { type: EventType.MESSAGES_SNAPSHOT, messages: snapshot },
  });
}

describe("attachmentRepair when a run ends", () => {
  it("drops a second copy of the same attachment", () => {
    expect(onRunFinalized([userMessage([TEXT, PNG, PNG])])).toEqual({
      messages: [userMessage([TEXT, PNG])],
    });
  });

  it("turns a PDF tagged as an image into a document part", () => {
    const pdfAsImage: ContentPart = {
      type: "image",
      source: { type: "data", value: "JVBERi0x", mimeType: "application/pdf" },
    };

    expect(onRunFinalized([userMessage([pdfAsImage])])).toEqual({
      messages: [
        userMessage([
          {
            type: "document",
            source: {
              type: "data",
              value: "JVBERi0x",
              mimeType: "application/pdf",
            },
          },
        ]),
      ],
    });
  });

  it("turns a legacy binary part into a modern part", () => {
    // A bridge on an old AG-UI version still sends the removed `binary` part.
    // That wire data does not match the 1.0 types, so it is parsed JSON here.
    const fromLegacyBridge: Message = JSON.parse(
      '{"id":"user-1","role":"user","content":[{"type":"binary","mimeType":"image/png","data":"iVBORw0K"}]}',
    );

    expect(onRunFinalized([fromLegacyBridge])).toEqual({
      messages: [userMessage([PNG])],
    });
  });

  it("changes nothing when every attachment renders", () => {
    expect(onRunFinalized([userMessage([TEXT, PNG]), ASSISTANT])).toBe(
      undefined,
    );
  });
});

describe("attachmentRepair on a messages snapshot", () => {
  it("puts back the attachments of a user message that the snapshot sends as text", () => {
    const current = [userMessage([TEXT, PNG])];
    const snapshot = [userMessage("What is in this file?"), ASSISTANT];

    expect(onSnapshot(current, snapshot)).toEqual({
      messages: [userMessage([TEXT, PNG]), ASSISTANT],
      stopPropagation: true,
    });
  });

  it("leaves a snapshot that keeps the attachments to the default handling", () => {
    const current = [userMessage([TEXT, PNG])];
    const snapshot = [userMessage([TEXT, PNG]), ASSISTANT];

    expect(onSnapshot(current, snapshot)).toBe(undefined);
  });
});
