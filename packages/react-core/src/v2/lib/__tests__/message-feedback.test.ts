import { CopilotKitCore } from "@copilotkit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushPendingMessageFeedback,
  getMessageFeedback,
  subscribeToMessageFeedback,
  MESSAGE_FEEDBACK_EVENT_NAME,
  setMessageFeedback,
  ɵresetMessageFeedbackCache,
} from "../message-feedback";

const emoji = "👍";

/**
 * A Core that records what it emits, with its capture state stubbed: it
 * captures into Trajectory `traj-1` until `capturing` is set to false.
 */
function capturingCore({ agentText = true } = {}) {
  const copilotkit = new CopilotKitCore({});
  const state = { capturing: true, agentText };
  vi.spyOn(copilotkit, "trajectoryId", "get").mockImplementation(() =>
    state.capturing ? "traj-1" : null,
  );
  vi.spyOn(copilotkit, "ɵlearningCapturesAgentText", "get").mockImplementation(
    () => state.agentText,
  );
  const emit = vi
    .spyOn(copilotkit, "emitTrajectoryEvent")
    .mockImplementation(() => {});
  return { copilotkit, emit, state };
}

const reply = { id: "m1", role: "assistant" as const, content: "Approved." };
/** The chat the ratings in these tests belong to. */
const chat = { agentId: "agent", threadId: "thread" };

const rate = (
  copilotkit: CopilotKitCore,
  rating: "up" | "down",
  message: { id: string; role: "assistant"; content: string } = reply,
) =>
  setMessageFeedback({
    copilotkit,
    agentId: "agent",
    threadId: "thread",
    message,
    feedback: { rating },
  });

const ratings = (emit: { mock: { calls: unknown[][] } }) =>
  emit.mock.calls.map(([, value]) =>
    typeof value === "object" && value !== null && "rating" in value
      ? value.rating
      : undefined,
  );

/** Storage key of the agent's Thread `thread`, as the store writes it. */
const threadStorageKey = `copilotkit:message-feedback:v1:${JSON.stringify(["agent", "thread"])}`;
const PENDING_STORAGE_KEY = "copilotkit:message-feedback-pending:v1";

/** Makes storage writes to keys that match `fails` throw, like a full quota. */
const failWrites = (fails: (key: string) => boolean) => {
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (fails(key)) throw new Error("QuotaExceededError");
    setItem.call(this, key, value);
  });
};

describe("message feedback store", () => {
  beforeEach(() => {
    localStorage.clear();
    ɵresetMessageFeedbackCache();
  });
  afterEach(() => vi.restoreAllMocks());

  it("cuts long text without splitting a character", () => {
    const { copilotkit, emit } = capturingCore();

    setMessageFeedback({
      copilotkit,
      agentId: "agent",
      threadId: "thread",
      message: { id: "m1", role: "assistant", content: emoji.repeat(600) },
      feedback: { rating: "up", comment: emoji.repeat(1200) },
    });

    const [name, value] = emit.mock.calls[0]!;
    expect(name).toBe(MESSAGE_FEEDBACK_EVENT_NAME);
    expect(value).toMatchObject({
      response: emoji.repeat(500),
      comment: emoji.repeat(1000),
    });
  });

  it("sends a waiting rating before a newer one, so the newest stays current", () => {
    const { copilotkit, emit, state } = capturingCore();
    state.capturing = false;
    rate(copilotkit, "up");
    state.capturing = true;

    rate(copilotkit, "down");
    flushPendingMessageFeedback(copilotkit, chat);

    expect(ratings(emit)).toEqual(["up", "down"]);
  });

  it("keeps a waiting rating across a reload", () => {
    const before = capturingCore();
    before.state.capturing = false;
    rate(before.copilotkit, "down");
    ɵresetMessageFeedbackCache();

    const after = capturingCore();
    flushPendingMessageFeedback(after.copilotkit, chat);
    // Sent once: the first flush empties the waiting list.
    flushPendingMessageFeedback(after.copilotkit, chat);

    expect(before.emit).not.toHaveBeenCalled();
    expect(ratings(after.emit)).toEqual(["down"]);
  });

  it("leaves waiting ratings of other chats for those chats", () => {
    const { copilotkit, emit, state } = capturingCore();
    state.capturing = false;
    rate(copilotkit, "up");
    state.capturing = true;

    flushPendingMessageFeedback(copilotkit, {
      agentId: "agent",
      threadId: "other",
    });
    expect(emit).not.toHaveBeenCalled();
    rate(copilotkit, "down", { id: "m2", role: "assistant", content: "No." });

    expect(ratings(emit)).toEqual(["up", "down"]);
  });

  it("keeps a rating of one Thread whose save failed while another Thread saves", () => {
    const { copilotkit } = capturingCore();
    const otherKey = `copilotkit:message-feedback:v1:${JSON.stringify(["agent", "other"])}`;
    failWrites((key) => key === threadStorageKey);
    rate(copilotkit, "up");
    setMessageFeedback({
      copilotkit,
      agentId: "agent",
      threadId: "other",
      message: reply,
      feedback: { rating: "down" },
    });
    expect(localStorage.getItem(otherKey)).not.toBeNull();

    rate(copilotkit, "down", { id: "m2", role: "assistant", content: "No." });

    expect(getMessageFeedback("agent", "thread", "m1")).toEqual({
      rating: "up",
    });
  });

  it("keeps the saved object of a rating that did not change", () => {
    const { copilotkit } = capturingCore();
    rate(copilotkit, "up");
    const before = getMessageFeedback("agent", "thread", "m1");

    rate(copilotkit, "down", { id: "m2", role: "assistant", content: "No." });

    expect(getMessageFeedback("agent", "thread", "m1")).toBe(before);
  });

  it("keeps an unsaved rating when another tab changes or clears storage", () => {
    const { copilotkit } = capturingCore();
    failWrites((key) => key === threadStorageKey);
    rate(copilotkit, "up");
    subscribeToMessageFeedback("agent", "thread", () => {})();

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: threadStorageKey,
        storageArea: localStorage,
      }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", { key: null, storageArea: localStorage }),
    );

    expect(getMessageFeedback("agent", "thread", "m1")).toEqual({
      rating: "up",
    });
  });

  it("keeps waiting ratings when storage can be read but not written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { copilotkit, emit, state } = capturingCore();
    rate(copilotkit, "up");
    state.capturing = false;
    rate(copilotkit, "down", { id: "m2", role: "assistant", content: "No." });
    state.capturing = true;

    flushPendingMessageFeedback(copilotkit, chat);

    expect(ratings(emit)).toEqual(["up", "down"]);
    expect(getMessageFeedback("agent", "thread", "m1")).toEqual({
      rating: "up",
    });
  });

  it("still sends ratings waiting from an earlier page after a rating save fails", () => {
    localStorage.setItem(
      PENDING_STORAGE_KEY,
      JSON.stringify({
        "thread:m0": {
          feedbackId: "thread:m0",
          messageId: "m0",
          rating: "down",
          agentId: "agent",
          threadId: "thread",
        },
      }),
    );
    failWrites((key) => key === threadStorageKey);
    const { copilotkit, emit } = capturingCore();

    rate(copilotkit, "up");

    expect(ratings(emit)).toEqual(["down", "up"]);
  });

  it("keeps a waiting rating whose queue write failed", () => {
    failWrites((key) => key === PENDING_STORAGE_KEY);
    const { copilotkit, emit, state } = capturingCore();
    state.capturing = false;
    rate(copilotkit, "up");
    rate(copilotkit, "down", { id: "m2", role: "assistant", content: "No." });
    state.capturing = true;

    flushPendingMessageFeedback(copilotkit, chat);

    expect(ratings(emit)).toEqual(["up", "down"]);
  });

  it("drops the reply text of a waiting rating once agent text is off", () => {
    const { copilotkit, emit, state } = capturingCore();
    state.capturing = false;
    rate(copilotkit, "up");
    state.capturing = true;
    state.agentText = false;

    flushPendingMessageFeedback(copilotkit, chat);

    expect(emit.mock.calls[0]![1]).not.toHaveProperty("response");
  });

  it("treats message ids like object keys as plain ids", () => {
    const { copilotkit } = capturingCore();

    rate(copilotkit, "up", { id: "__proto__", role: "assistant", content: "" });
    ɵresetMessageFeedbackCache();

    expect(getMessageFeedback("agent", "thread", "__proto__")).toEqual({
      rating: "up",
    });
    expect(
      getMessageFeedback("agent", "thread", "constructor"),
    ).toBeUndefined();
  });

  it("follows changes to local storage, not to session storage", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToMessageFeedback("agent", "thread", listener);
    const change = (storageArea: Storage) =>
      window.dispatchEvent(
        new StorageEvent("storage", { key: threadStorageKey, storageArea }),
      );

    change(sessionStorage);
    expect(listener).not.toHaveBeenCalled();
    change(localStorage);
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("leaves out the reply text when capture omits agent text", () => {
    const { copilotkit, emit } = capturingCore({ agentText: false });

    rate(copilotkit, "up");

    expect(emit.mock.calls[0]![1]).not.toHaveProperty("response");
  });

  it("names the reply's run when Core knows it", () => {
    const { copilotkit, emit } = capturingCore();
    vi.spyOn(copilotkit, "getRunIdForMessage").mockReturnValue("run-9");

    rate(copilotkit, "up");

    expect(emit.mock.calls[0]![1]).toMatchObject({ runId: "run-9" });
  });

  it("keeps ratings another tab saved meanwhile", () => {
    const { copilotkit } = capturingCore();
    rate(copilotkit, "up");
    const key = threadStorageKey;
    const other = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(
      key,
      JSON.stringify({ ...other, m2: { rating: "down" } }),
    );

    rate(copilotkit, "up", { id: "m3", role: "assistant", content: "Done." });

    expect(Object.keys(JSON.parse(localStorage.getItem(key)!))).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });

  it("reads saved feedback with the same rules as new feedback", () => {
    localStorage.setItem(
      threadStorageKey,
      JSON.stringify({
        m1: { rating: "up", comment: "  padded  " },
        m2: { rating: "meh" },
        m3: { rating: "down", comment: "   " },
      }),
    );

    expect(getMessageFeedback("agent", "thread", "m1")).toEqual({
      rating: "up",
      comment: "padded",
    });
    expect(getMessageFeedback("agent", "thread", "m2")).toBeUndefined();
    expect(getMessageFeedback("agent", "thread", "m3")).toEqual({
      rating: "down",
    });
  });
});
