import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@ag-ui/core";
import type { LearningSink } from "@copilotkit/learning";
import { CopilotKitCore } from "../../core";
import {
  ɵFEEDBACK_COMMENT_CLOSE_DELAY_MS,
  ɵFeedbackCommentController,
  ɵMESSAGE_FEEDBACK_EVENT_NAME,
  ɵgetMessageFeedback,
  ɵgetMessageFeedbackControls,
  ɵisLearningFeedbackEnabled,
  ɵresetMessageFeedbackCache,
  ɵsetMessageFeedback,
  ɵsubscribeToLearningFeedbackEnabled,
  ɵsubscribeToMessageFeedback,
} from "../message-feedback";
import type {
  ɵMessageFeedback,
  ɵMessageFeedbackControls,
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

const sink: LearningSink = () => {};
const localLearning = {
  sink,
  capture: { clicks: false, navigation: false, network: false },
};

/**
 * A Core with a local Learning sink. A capture needs a browser page, so the
 * Trajectory ID, the capture boundary, is stubbed and `capture(id)` sets it.
 */
function learningCore() {
  const copilotkit = new CopilotKitCore({ learning: localLearning });
  let trajectoryId: string | null = null;
  vi.spyOn(copilotkit, "trajectoryId", "get").mockImplementation(
    () => trajectoryId,
  );
  const capture = (id: string | null) => {
    trajectoryId = id;
  };
  return { copilotkit, capture };
}

const reply: AssistantMessage = {
  id: "m1",
  role: "assistant",
  content: "Approved.",
};

const rate = (
  copilotkit: CopilotKitCore,
  feedback: ɵMessageFeedback | null,
  message: AssistantMessage = reply,
) =>
  ɵsetMessageFeedback({
    copilotkit,
    agentId: "agent",
    threadId: "thread",
    message,
    feedback,
  });

beforeEach(() => ɵresetMessageFeedbackCache());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("message feedback store", () => {
  it("cuts long text without splitting a character", () => {
    const { copilotkit, emit } = capturingCore();

    rate(
      copilotkit,
      { rating: "up", comment: emoji.repeat(1200) },
      { id: "m1", role: "assistant", content: emoji.repeat(600) },
    );

    const [name, value] = emit.mock.calls[0]!;
    expect(name).toBe(ɵMESSAGE_FEEDBACK_EVENT_NAME);
    expect(value).toMatchObject({
      response: emoji.repeat(500),
      comment: emoji.repeat(1000),
    });
  });

  it("keeps the rating and sends each change, a removal as null", () => {
    const { copilotkit, emit } = capturingCore();

    rate(copilotkit, { rating: "up" });
    expect(ɵgetMessageFeedback("agent", "thread", "m1")).toEqual({
      rating: "up",
    });
    rate(copilotkit, null);

    expect(ɵgetMessageFeedback("agent", "thread", "m1")).toBeUndefined();
    expect(emit.mock.calls.map(([, value]) => value)).toEqual([
      expect.objectContaining({ feedbackId: "thread:m1", rating: "up" }),
      expect.objectContaining({ feedbackId: "thread:m1", rating: null }),
    ]);
  });

  it("trims a comment and drops a blank one", () => {
    const { copilotkit } = capturingCore();

    rate(copilotkit, { rating: "down", comment: "   " });
    expect(ɵgetMessageFeedback("agent", "thread", "m1")).toEqual({
      rating: "down",
    });
    rate(copilotkit, { rating: "down", comment: "  padded  " });

    expect(ɵgetMessageFeedback("agent", "thread", "m1")).toEqual({
      rating: "down",
      comment: "padded",
    });
  });

  it("tells only the rated Thread's listeners", () => {
    const { copilotkit } = capturingCore();
    const rated = vi.fn();
    const other = vi.fn();
    ɵsubscribeToMessageFeedback("agent", "thread", rated);
    ɵsubscribeToMessageFeedback("agent", "other", other);

    rate(copilotkit, { rating: "up" });

    expect(rated).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it("stops telling a listener that unsubscribed", () => {
    const { copilotkit } = capturingCore();
    const listener = vi.fn();
    const unsubscribe = ɵsubscribeToMessageFeedback(
      "agent",
      "thread",
      listener,
    );

    unsubscribe();
    rate(copilotkit, { rating: "up" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps the object of a rating that did not change", () => {
    const { copilotkit } = capturingCore();
    rate(copilotkit, { rating: "up" });
    const before = ɵgetMessageFeedback("agent", "thread", "m1");

    rate(
      copilotkit,
      { rating: "down" },
      { id: "m2", role: "assistant", content: "No." },
    );

    expect(ɵgetMessageFeedback("agent", "thread", "m1")).toBe(before);
  });

  it("treats message ids like object keys as plain ids", () => {
    const { copilotkit } = capturingCore();

    rate(
      copilotkit,
      { rating: "up" },
      { id: "__proto__", role: "assistant", content: "" },
    );

    expect(ɵgetMessageFeedback("agent", "thread", "__proto__")).toEqual({
      rating: "up",
    });
    expect(
      ɵgetMessageFeedback("agent", "thread", "constructor"),
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

describe("ɵisLearningFeedbackEnabled", () => {
  it("is false without a Learning config", () => {
    expect(ɵisLearningFeedbackEnabled(new CopilotKitCore({}))).toBe(false);
  });

  it("is false while Learning is configured but capture never started", () => {
    expect(ɵisLearningFeedbackEnabled(learningCore().copilotkit)).toBe(false);
  });

  it("stays true after capture stops, while Learning stays configured", () => {
    const { copilotkit, capture } = learningCore();
    capture("t1");
    expect(ɵisLearningFeedbackEnabled(copilotkit)).toBe(true);

    capture(null);

    expect(ɵisLearningFeedbackEnabled(copilotkit)).toBe(true);
  });

  it("forgets a past capture once the Learning config goes", () => {
    const { copilotkit, capture } = learningCore();
    capture("t1");
    ɵisLearningFeedbackEnabled(copilotkit);
    capture(null);

    copilotkit.setLearningConfig(undefined);
    expect(ɵisLearningFeedbackEnabled(copilotkit)).toBe(false);
    copilotkit.setLearningConfig(localLearning);

    expect(ɵisLearningFeedbackEnabled(copilotkit)).toBe(false);
  });

  it("notifies when the config goes and stops after unsubscribe", async () => {
    const { copilotkit } = learningCore();
    const listener = vi.fn();
    const unsubscribe = ɵsubscribeToLearningFeedbackEnabled(
      copilotkit,
      listener,
    );

    copilotkit.setLearningConfig(undefined);
    await Promise.resolve();
    const calls = listener.mock.calls.length;
    unsubscribe();
    copilotkit.setLearningConfig(localLearning);
    await Promise.resolve();

    expect(calls).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalledTimes(calls);
  });
});

describe("ɵgetMessageFeedbackControls", () => {
  const controlsFor = (copilotkit: CopilotKitCore) =>
    ɵgetMessageFeedbackControls(
      { copilotkit, agentId: "agent", threadId: "thread" },
      reply,
    );

  it("rates, comments, and clears through the store", () => {
    const { copilotkit } = capturingCore();

    controlsFor(copilotkit).rate("up");
    controlsFor(copilotkit).comment("Nice");
    expect(controlsFor(copilotkit).feedback).toEqual({
      rating: "up",
      comment: "Nice",
    });
    controlsFor(copilotkit).clear();

    expect(controlsFor(copilotkit).feedback).toBeUndefined();
  });

  it("sends nothing for the same rating again", () => {
    const { copilotkit, emit } = capturingCore();
    controlsFor(copilotkit).rate("up");

    controlsFor(copilotkit).rate("up");

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("drops the comment when the rating changes", () => {
    const { copilotkit } = capturingCore();
    rate(copilotkit, { rating: "up", comment: "Nice" });

    controlsFor(copilotkit).rate("down");

    expect(controlsFor(copilotkit).feedback).toEqual({ rating: "down" });
  });

  it("ignores a comment or a clear without a rating", () => {
    const { copilotkit, emit } = capturingCore();

    controlsFor(copilotkit).comment("Nice");
    controlsFor(copilotkit).clear();

    expect(emit).not.toHaveBeenCalled();
    expect(controlsFor(copilotkit).feedback).toBeUndefined();
  });
});

describe("ɵFeedbackCommentController", () => {
  /** A comment controller over a rated message whose comments are recorded. */
  function ratedComment(saved = "") {
    const comments: string[] = [];
    const controls: ɵMessageFeedbackControls = {
      feedback: { rating: "up", ...(saved ? { comment: saved } : {}) },
      rate: () => {},
      clear: () => {},
      comment: (text) => {
        comments.push(text);
      },
    };
    const controller = new ɵFeedbackCommentController({
      getControls: () => controls,
    });
    return { controller, comments };
  }

  it("opens on enter with the saved comment", () => {
    const { controller } = ratedComment("Saved");

    controller.enter("pointer");

    expect(controller.getSnapshot()).toEqual({
      open: true,
      draft: "Saved",
      focusRequest: 0,
    });
  });

  it("does not open on enter for an unrated message", () => {
    const controller = new ɵFeedbackCommentController({
      getControls: () => null,
    });

    controller.enter();

    expect(controller.getSnapshot().open).toBe(false);
  });

  it("closes after the delay once the pointer leaves", () => {
    vi.useFakeTimers();
    const { controller } = ratedComment();
    controller.enter("pointer");

    controller.leave("pointer");
    vi.advanceTimersByTime(ɵFEEDBACK_COMMENT_CLOSE_DELAY_MS - 1);
    expect(controller.getSnapshot().open).toBe(true);
    vi.advanceTimersByTime(1);

    expect(controller.getSnapshot().open).toBe(false);
  });

  it("stays open when the pointer comes back before the delay", () => {
    vi.useFakeTimers();
    const { controller } = ratedComment();
    controller.enter("pointer");

    controller.leave("pointer");
    controller.enter("pointer");
    vi.advanceTimersByTime(ɵFEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(controller.getSnapshot().open).toBe(true);
  });

  it("ignores a focus leave while the pointer is still over it", () => {
    vi.useFakeTimers();
    const { controller } = ratedComment();
    controller.enter("pointer");

    controller.leave("focus");
    vi.advanceTimersByTime(ɵFEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(controller.getSnapshot().open).toBe(true);
  });

  it("stays open while the comment is being edited", () => {
    vi.useFakeTimers();
    const { controller } = ratedComment();
    controller.enter("pointer");
    controller.setEditing(true);

    controller.leave("pointer");
    vi.advanceTimersByTime(ɵFEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(controller.getSnapshot().open).toBe(true);
  });

  it("saves a changed comment on close", () => {
    const { controller, comments } = ratedComment("Old");
    controller.enter();
    controller.setDraft("New");

    controller.close();

    expect(comments).toEqual(["New"]);
    expect(controller.getSnapshot().open).toBe(false);
  });

  it("does not save an unchanged comment or one closed without save", () => {
    const { controller, comments } = ratedComment("Same");
    controller.enter();
    controller.setDraft("  Same  ");
    controller.close();
    controller.enter();
    controller.setDraft("Discarded");

    controller.close({ save: false });

    expect(comments).toEqual([]);
  });

  it("counts focus requests and answers each once", () => {
    const { controller } = ratedComment();

    controller.show({ comment: "", focus: true });

    expect(controller.getSnapshot().focusRequest).toBe(1);
    expect(controller.takeFocusRequest()).toBe(true);
    expect(controller.takeFocusRequest()).toBe(false);
  });

  it("does not reopen while focus returns to the thumb", () => {
    const { controller } = ratedComment();
    const thumb = { focus: () => controller.enter("focus") };

    controller.returnFocus(thumb);

    expect(controller.getSnapshot().open).toBe(false);
  });

  it("keeps the same snapshot and skips listeners when nothing changes", () => {
    const { controller } = ratedComment();
    const listener = vi.fn();
    controller.subscribe(listener);
    const before = controller.getSnapshot();

    controller.setDraft("");
    controller.close();

    expect(controller.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("saves an open edit on dispose and stops the close timer", () => {
    vi.useFakeTimers();
    const { controller, comments } = ratedComment();
    controller.enter("pointer");
    controller.setDraft("Unsaved");
    controller.leave("pointer");

    controller.dispose();
    vi.advanceTimersByTime(ɵFEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(comments).toEqual(["Unsaved"]);
    expect(controller.getSnapshot().open).toBe(true);
  });
});
