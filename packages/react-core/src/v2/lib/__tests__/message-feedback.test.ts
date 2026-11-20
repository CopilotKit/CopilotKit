import { CopilotKitCore } from "@copilotkit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMessageFeedback,
  subscribeToMessageFeedback,
  MESSAGE_FEEDBACK_EVENT_NAME,
  setMessageFeedback,
  ɵresetMessageFeedbackCache,
} from "../message-feedback";

const emoji = "👍";

/** A Core that records what it emits, with its agent-text choice stubbed. */
function capturingCore({ agentText = true } = {}) {
  const copilotkit = new CopilotKitCore({});
  vi.spyOn(copilotkit, "ɵlearningCapturesAgentText", "get").mockReturnValue(
    agentText,
  );
  const emit = vi
    .spyOn(copilotkit, "emitTrajectoryEvent")
    .mockImplementation(() => {});
  return { copilotkit, emit };
}

const reply = { id: "m1", role: "assistant" as const, content: "Approved." };

const rate = (
  copilotkit: CopilotKitCore,
  feedback: { rating: "up" | "down"; comment?: string } | null,
  message: { id: string; role: "assistant"; content: string } = reply,
) =>
  setMessageFeedback({
    copilotkit,
    agentId: "agent",
    threadId: "thread",
    message,
    feedback,
  });

describe("message feedback store", () => {
  beforeEach(() => ɵresetMessageFeedbackCache());
  afterEach(() => vi.restoreAllMocks());

  it("cuts long text without splitting a character", () => {
    const { copilotkit, emit } = capturingCore();

    rate(
      copilotkit,
      { rating: "up", comment: emoji.repeat(1200) },
      { id: "m1", role: "assistant", content: emoji.repeat(600) },
    );

    const [name, value] = emit.mock.calls[0]!;
    expect(name).toBe(MESSAGE_FEEDBACK_EVENT_NAME);
    expect(value).toMatchObject({
      response: emoji.repeat(500),
      comment: emoji.repeat(1000),
    });
  });

  it("keeps the rating and sends each change, a removal as null", () => {
    const { copilotkit, emit } = capturingCore();

    rate(copilotkit, { rating: "up" });
    expect(getMessageFeedback("agent", "thread", "m1")).toEqual({
      rating: "up",
    });
    rate(copilotkit, null);

    expect(getMessageFeedback("agent", "thread", "m1")).toBeUndefined();
    expect(emit.mock.calls.map(([, value]) => value)).toEqual([
      expect.objectContaining({ feedbackId: "thread:m1", rating: "up" }),
      expect.objectContaining({ feedbackId: "thread:m1", rating: null }),
    ]);
  });

  it("trims a comment and drops a blank one", () => {
    const { copilotkit } = capturingCore();

    rate(copilotkit, { rating: "down", comment: "   " });
    expect(getMessageFeedback("agent", "thread", "m1")).toEqual({
      rating: "down",
    });
    rate(copilotkit, { rating: "down", comment: "  padded  " });

    expect(getMessageFeedback("agent", "thread", "m1")).toEqual({
      rating: "down",
      comment: "padded",
    });
  });

  it("tells only the rated Thread's listeners", () => {
    const { copilotkit } = capturingCore();
    const rated = vi.fn();
    const other = vi.fn();
    subscribeToMessageFeedback("agent", "thread", rated);
    subscribeToMessageFeedback("agent", "other", other);

    rate(copilotkit, { rating: "up" });

    expect(rated).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("keeps the object of a rating that did not change", () => {
    const { copilotkit } = capturingCore();
    rate(copilotkit, { rating: "up" });
    const before = getMessageFeedback("agent", "thread", "m1");

    rate(
      copilotkit,
      { rating: "down" },
      { id: "m2", role: "assistant", content: "No." },
    );

    expect(getMessageFeedback("agent", "thread", "m1")).toBe(before);
  });

  it("treats message ids like object keys as plain ids", () => {
    const { copilotkit } = capturingCore();

    rate(
      copilotkit,
      { rating: "up" },
      { id: "__proto__", role: "assistant", content: "" },
    );

    expect(getMessageFeedback("agent", "thread", "__proto__")).toEqual({
      rating: "up",
    });
    expect(
      getMessageFeedback("agent", "thread", "constructor"),
    ).toBeUndefined();
  });

  it("leaves out the reply text when capture omits agent text", () => {
    const { copilotkit, emit } = capturingCore({ agentText: false });

    rate(copilotkit, { rating: "up" });

    expect(emit.mock.calls[0]![1]).not.toHaveProperty("response");
  });

  it("names the reply's run when Core knows it", () => {
    const { copilotkit, emit } = capturingCore();
    vi.spyOn(copilotkit, "getRunIdForMessage").mockReturnValue("run-9");

    rate(copilotkit, { rating: "up" });

    expect(emit.mock.calls[0]![1]).toMatchObject({ runId: "run-9" });
  });
});
