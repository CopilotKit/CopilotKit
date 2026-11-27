import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  stateSnapshotEvent,
  generateMessages,
  textChunkEvent,
} from "../../../__tests__/utils/test-helpers";
import type { ReactCustomMessageRenderer } from "../../../types/react-custom-message-renderer";

/**
 * Measures how many bytes of the agent's STATE_SNAPSHOT the message view
 * serializes on a single re-render, with NO custom message renderers registered.
 *
 * The chain under measurement (CopilotChatMessageView):
 *   1. `useRenderCustomMessages()` returns a function whenever a chat
 *      configuration exists — the renderer list is only consulted *inside*
 *      that function — so `renderCustomMessage` is truthy with zero renderers.
 *   2. `renderMessageBlock` calls `getStateSnapshotForMessage(message.id)`
 *      unconditionally, which calls `getStateByRun` →
 *      `JSON.parse(JSON.stringify(state))`.
 *   3. Two `<MemoizedCustomMessage>` mount per message, and their comparator
 *      runs `JSON.stringify(prev.stateSnapshot) !== JSON.stringify(next.stateSnapshot)`.
 *   4. `agent.subscribe({ onStateChanged: forceUpdate })` re-renders the whole
 *      view on every state event, repeating 1–3.
 *
 * Net: O(messages × stateSize) of serialization per state event, for output
 * nothing renders.
 */

const MARKER = "__cost_probe__";

/** A LangGraph-shaped snapshot: a `messages` channel plus some agent fields. */
function makeSnapshot(channelEntries: number, tick = 0) {
  return {
    [MARKER]: true,
    tick,
    messages: Array.from({ length: channelEntries }, (_, i) => ({
      id: `lg-${i}`,
      type: i % 2 === 0 ? "human" : "ai",
      content:
        `Turn ${i}: ` +
        "the quick brown fox jumps over the lazy dog. ".repeat(12),
      additional_kwargs: {},
      response_metadata: {},
    })),
    plan: { step: 3, total: 7 },
  };
}

/** Counts bytes of OUR snapshot object passed through JSON.stringify. */
function installSerializationProbe() {
  const original = JSON.stringify;
  const probe = { calls: 0, bytes: 0, enabled: false };
  const spy = vi.spyOn(JSON, "stringify").mockImplementation(function (
    ...args: unknown[]
  ) {
    const out = (original as any).apply(JSON, args);
    const value = args[0] as Record<string, unknown> | null;
    if (
      probe.enabled &&
      value &&
      typeof value === "object" &&
      MARKER in value
    ) {
      probe.calls += 1;
      probe.bytes += typeof out === "string" ? out.length : 0;
    }
    return out;
  } as any);
  return { probe, restore: () => spy.mockRestore() };
}

/**
 * Starts a real run (so CopilotKitCore wires its state subscription), streams
 * `messageCount` assistant messages, and lands a STATE_SNAPSHOT on that run.
 */
async function seedThread(
  messageCount: number,
  channelEntries: number,
  renderCustomMessages?: ReactCustomMessageRenderer[],
) {
  const agent = new MockStepwiseAgent();
  renderWithCopilotKit({ agent, renderCustomMessages });

  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "start" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(screen.getByText("start")).toBeDefined());

  await act(async () => {
    agent.emit(runStartedEvent());
    for (const event of generateMessages(messageCount)) agent.emit(event);
    agent.emit(stateSnapshotEvent(makeSnapshot(channelEntries)));
    await Promise.resolve();
  });

  return agent;
}

/** Emits one more state snapshot and returns bytes serialized during it. */
async function measureOneStateEvent(
  agent: MockStepwiseAgent,
  channelEntries: number,
) {
  const { probe, restore } = installSerializationProbe();
  probe.enabled = true;
  await act(async () => {
    agent.emit(stateSnapshotEvent(makeSnapshot(channelEntries, 1)));
    await Promise.resolve();
  });
  probe.enabled = false;
  restore();
  return { calls: probe.calls, bytes: probe.bytes };
}

/** Streams one text chunk into the last message and returns bytes serialized during it. */
async function measureOneTextChunk(
  agent: MockStepwiseAgent,
  messageCount: number,
) {
  const { probe, restore } = installSerializationProbe();
  probe.enabled = true;
  await act(async () => {
    agent.emit(textChunkEvent(`gen-msg-${messageCount - 1}`, " and more"));
    await Promise.resolve();
  });
  probe.enabled = false;
  restore();
  return { calls: probe.calls, bytes: probe.bytes };
}

describe("state-snapshot serialization cost per render (no custom renderers)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serializes the whole snapshot repeatedly on a single state event", async () => {
    const MESSAGES = 60;
    const CHANNEL = 40;

    const agent = await seedThread(MESSAGES, CHANNEL);
    const { calls, bytes } = await measureOneStateEvent(agent, CHANNEL);

    const snapshotBytes = JSON.stringify(makeSnapshot(CHANNEL)).length;

    // eslint-disable-next-line no-console
    console.log(
      `[cost] messages=${MESSAGES} snapshot=${(snapshotBytes / 1024).toFixed(1)}KB ` +
        `→ stringify calls=${calls}, bytes=${(bytes / 1024 / 1024).toFixed(2)}MB ` +
        `(= ${(bytes / snapshotBytes).toFixed(1)}× the snapshot, for zero rendered output)`,
    );

    // The message view must not serialize the snapshot per message. A small
    // constant number of passes (the state manager storing the event) is fine;
    // anything proportional to MESSAGES is the regression.
    expect(calls).toBeLessThan(5);
  });

  it("cost scales with thread length", async () => {
    const CHANNEL = 40;
    const results: Record<number, number> = {};

    for (const messageCount of [20, 40, 80]) {
      cleanup();
      const agent = await seedThread(messageCount, CHANNEL);
      const { bytes } = await measureOneStateEvent(agent, CHANNEL);
      results[messageCount] = bytes;
      // eslint-disable-next-line no-console
      console.log(
        `[scaling] messages=${messageCount} → ${(bytes / 1024 / 1024).toFixed(2)}MB serialized per state event`,
      );
    }

    expect(results[80]!).toBeLessThanOrEqual(results[20]! * 1.5);
  });
});

describe("state-snapshot serialization cost per render (a custom renderer registered)", () => {
  // The `<CopilotKit>` provider always registers one (the CoAgent state render
  // bridge), so this is the path most apps take.
  const renderCustomMessages: ReactCustomMessageRenderer[] = [
    { render: () => null },
  ];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not serialize the snapshot per message while text streams", async () => {
    const MESSAGES = 60;
    const CHANNEL = 40;

    const agent = await seedThread(MESSAGES, CHANNEL, renderCustomMessages);
    const { calls, bytes } = await measureOneTextChunk(agent, MESSAGES);

    // eslint-disable-next-line no-console
    console.log(
      `[cost, renderer registered] messages=${MESSAGES} → stringify calls=${calls}, ` +
        `bytes=${(bytes / 1024 / 1024).toFixed(2)}MB for one text chunk`,
    );

    // Only the message that changed may re-render its custom messages, and the
    // state did not change. Anything proportional to MESSAGES is the regression.
    expect(calls).toBeLessThan(5);
  });

  it("text-chunk cost does not scale with thread length", async () => {
    const CHANNEL = 40;
    const results: Record<number, number> = {};

    for (const messageCount of [20, 80]) {
      cleanup();
      const agent = await seedThread(
        messageCount,
        CHANNEL,
        renderCustomMessages,
      );
      const { bytes } = await measureOneTextChunk(agent, messageCount);
      results[messageCount] = bytes;
    }

    expect(results[80]!).toBeLessThanOrEqual(results[20]! * 1.5);
  });
});
