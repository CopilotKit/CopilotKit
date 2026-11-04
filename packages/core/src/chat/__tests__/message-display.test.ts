import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolMessage, UserMessage } from "@ag-ui/core";
import { CopilotChatDefaultLabels as labels } from "../labels";
import type { ToolCallEntry } from "../tool-call-layout";
import {
  ɵCOPY_FEEDBACK_RESET_MS,
  ɵCopyFeedback,
  ɵflattenUserMessageContent,
  ɵformatReasoningDurationLabel,
  ɵgetBranchNavState,
  ɵgetReasoningHeaderLabel,
  ɵgetUserMessageMediaFilename,
  ɵgetUserMessageMediaParts,
  ɵgetWorkSummaryText,
  ɵhasAssistantMessageText,
  ɵReasoningDisclosure,
  ɵshouldShowAssistantToolbar,
} from "../message-display";

const call = (id: string, error?: string): ToolCallEntry => {
  const toolMessage: ToolMessage | undefined = error
    ? { id: `r-${id}`, role: "tool", toolCallId: id, content: "", error }
    : undefined;
  return {
    toolCall: {
      id,
      type: "function",
      function: { name: "search", arguments: "{}" },
    },
    toolMessage,
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ɵformatReasoningDurationLabel", () => {
  it.each([
    [0.4, "a few seconds"],
    [4.4, "4 seconds"],
    [60, "1 minute"],
    [120, "2 minutes"],
    [65, "1m 5s"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    expect(ɵformatReasoningDurationLabel(seconds, labels)).toBe(expected);
  });
});

describe("ɵgetWorkSummaryText", () => {
  const base = { calls: [call("a"), call("b")], now: 10_000, labels };

  it("shows the live timer while working", () => {
    expect(
      ɵgetWorkSummaryText({
        ...base,
        isWorking: true,
        elapsedMs: 2000,
        workingSince: 7000,
      }),
    ).toEqual({ label: "Working", detail: "5s", failed: null });
  });

  it("shows no timer while working without a known time", () => {
    expect(ɵgetWorkSummaryText({ ...base, isWorking: true })).toEqual({
      label: "Working",
      detail: null,
      failed: null,
    });
  });

  it("does not count time before the run started", () => {
    expect(
      ɵgetWorkSummaryText({
        ...base,
        isWorking: true,
        elapsedMs: 3000,
        workingSince: 20_000,
      }).detail,
    ).toBe("3s");
  });

  it("shows the worked time and the tool count when done", () => {
    expect(
      ɵgetWorkSummaryText({ ...base, isWorking: false, elapsedMs: 9500 }),
    ).toEqual({ label: "Worked for 9s", detail: "2 tools", failed: null });
  });

  it("shows at least a second of work", () => {
    expect(
      ɵgetWorkSummaryText({ ...base, isWorking: false, elapsedMs: 200 }).label,
    ).toBe("Worked for 1s");
  });

  it("shows the tools used when the time is not known", () => {
    expect(
      ɵgetWorkSummaryText({ ...base, calls: [call("a")], isWorking: false }),
    ).toEqual({ label: "Used 1 tool", detail: null, failed: null });
  });

  it("counts failed tool calls when done", () => {
    expect(
      ɵgetWorkSummaryText({
        ...base,
        calls: [call("a", "boom"), call("b")],
        isWorking: false,
      }).failed,
    ).toBe("1 failed");
  });
});

describe("user message content", () => {
  const image = {
    type: "image",
    source: { type: "url", value: "https://example.com/cat.png" },
    metadata: { filename: "cat.png" },
  } as const;
  const content: UserMessage["content"] = [
    { type: "text", text: "First" },
    image,
    { type: "text", text: "" },
    { type: "text", text: "Second" },
  ];

  it("joins the text parts with newlines", () => {
    expect(ɵflattenUserMessageContent(content)).toBe("First\nSecond");
  });

  it("returns string content as it is and nothing for none", () => {
    expect(ɵflattenUserMessageContent("Hi")).toBe("Hi");
    expect(ɵflattenUserMessageContent(undefined)).toBe("");
  });

  it("skips malformed parts from untyped data", () => {
    const untyped = JSON.parse(
      '[null, {"type":"text"}, {"type":"text","text":"ok"}]',
    );

    expect(ɵflattenUserMessageContent(untyped)).toBe("ok");
  });

  it("finds the media parts and their file names", () => {
    const media = ɵgetUserMessageMediaParts(content);

    expect(media).toEqual([image]);
    expect(ɵgetUserMessageMediaFilename(media[0]!)).toBe("cat.png");
    expect(ɵgetUserMessageMediaParts("text only")).toEqual([]);
  });

  it("has no file name without one in the metadata", () => {
    expect(
      ɵgetUserMessageMediaFilename({
        type: "image",
        source: { type: "url", value: "https://example.com/a.png" },
        metadata: { filename: 42 },
      }),
    ).toBeUndefined();
  });
});

describe("ɵgetBranchNavState", () => {
  it("shows the arrows that lead to another branch", () => {
    expect(
      ɵgetBranchNavState({
        branchIndex: 0,
        numberOfBranches: 3,
        canSwitch: true,
      }),
    ).toEqual({ show: true, canGoPrev: false, canGoNext: true });
    expect(
      ɵgetBranchNavState({
        branchIndex: 2,
        numberOfBranches: 3,
        canSwitch: true,
      }),
    ).toEqual({ show: true, canGoPrev: true, canGoNext: false });
  });

  it("hides with one branch", () => {
    expect(
      ɵgetBranchNavState({
        branchIndex: 0,
        numberOfBranches: 1,
        canSwitch: true,
      }).show,
    ).toBe(false);
  });

  it("hides without a switch handler", () => {
    expect(
      ɵgetBranchNavState({
        branchIndex: 1,
        numberOfBranches: 3,
        canSwitch: false,
      }),
    ).toEqual({ show: false, canGoPrev: false, canGoNext: false });
  });
});

describe("assistant toolbar", () => {
  const visible = {
    toolbarVisible: true,
    hasContent: true,
    showInspectorShortcut: false,
    isRunning: false,
    isLatest: true,
  };

  it("shows for a finished message with text", () => {
    expect(ɵshouldShowAssistantToolbar(visible)).toBe(true);
  });

  it("hides while the latest message streams", () => {
    expect(ɵshouldShowAssistantToolbar({ ...visible, isRunning: true })).toBe(
      false,
    );
  });

  it("shows for an older message while the agent runs", () => {
    expect(
      ɵshouldShowAssistantToolbar({
        ...visible,
        isRunning: true,
        isLatest: false,
      }),
    ).toBe(true);
  });

  it("shows without text only for the Inspector shortcut", () => {
    expect(ɵshouldShowAssistantToolbar({ ...visible, hasContent: false })).toBe(
      false,
    );
    expect(
      ɵshouldShowAssistantToolbar({
        ...visible,
        hasContent: false,
        showInspectorShortcut: true,
      }),
    ).toBe(true);
  });

  it("hides when toolbars are off", () => {
    expect(
      ɵshouldShowAssistantToolbar({ ...visible, toolbarVisible: false }),
    ).toBe(false);
  });

  it("counts only text beyond whitespace", () => {
    expect(ɵhasAssistantMessageText("  \n")).toBe(false);
    expect(ɵhasAssistantMessageText(undefined)).toBe(false);
    expect(ɵhasAssistantMessageText(" ok ")).toBe(true);
  });
});

describe("ɵCopyFeedback", () => {
  it("shows the check mark for the reset time", () => {
    vi.useFakeTimers();
    const feedback = new ɵCopyFeedback();

    feedback.markCopied();
    vi.advanceTimersByTime(ɵCOPY_FEEDBACK_RESET_MS - 1);
    expect(feedback.getSnapshot()).toBe(true);
    vi.advanceTimersByTime(1);

    expect(feedback.getSnapshot()).toBe(false);
  });

  it("restarts the wait on a second copy instead of flickering", () => {
    vi.useFakeTimers();
    const feedback = new ɵCopyFeedback();
    const states: boolean[] = [];
    feedback.subscribe(() => states.push(feedback.getSnapshot()));

    feedback.markCopied();
    vi.advanceTimersByTime(1500);
    feedback.markCopied();
    vi.advanceTimersByTime(1500);

    expect(feedback.getSnapshot()).toBe(true);
    expect(states).toEqual([true]);
  });

  it("stops the reset on dispose", () => {
    vi.useFakeTimers();
    const feedback = new ɵCopyFeedback();
    feedback.markCopied();

    feedback.dispose();
    vi.advanceTimersByTime(ɵCOPY_FEEDBACK_RESET_MS);

    expect(feedback.getSnapshot()).toBe(true);
  });

  it("copies with the clipboard and shows the check mark", async () => {
    const written: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });
    const feedback = new ɵCopyFeedback();

    await expect(feedback.copy("Hello")).resolves.toBe(true);

    expect(written).toEqual(["Hello"]);
    expect(feedback.getSnapshot()).toBe(true);
    feedback.dispose();
  });

  it("copies nothing for empty text", async () => {
    const feedback = new ɵCopyFeedback();

    await expect(feedback.copy("")).resolves.toBe(false);

    expect(feedback.getSnapshot()).toBe(false);
  });

  it("stays unchecked when the clipboard write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    const feedback = new ɵCopyFeedback();

    await expect(feedback.copy("Hello")).resolves.toBe(false);

    expect(feedback.getSnapshot()).toBe(false);
  });
});

describe("ɵgetReasoningHeaderLabel", () => {
  it("reads as thinking while the model reasons", () => {
    expect(
      ɵgetReasoningHeaderLabel(
        { isStreaming: true, elapsedSeconds: 12 },
        labels,
      ),
    ).toBe(labels.reasoningMessageThinkingLabel);
  });

  it("says how long the model thought once it stops", () => {
    expect(
      ɵgetReasoningHeaderLabel(
        { isStreaming: false, elapsedSeconds: 4 },
        labels,
      ),
    ).toBe("Thought for 4 seconds");
  });
});

describe("ɵReasoningDisclosure", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const start = (isStreaming = true) => {
    vi.useFakeTimers();
    const disclosure = new ɵReasoningDisclosure({ isStreaming });
    disclosure.setStreaming(isStreaming);
    return disclosure;
  };

  it("starts closed with no time for a message that is not streaming", () => {
    const disclosure = start(false);
    expect(disclosure.getSnapshot()).toEqual({
      isStreaming: false,
      isOpen: false,
      elapsedSeconds: 0,
    });
  });

  it("is open while streaming and closes with the final time when it ends", () => {
    const disclosure = start();
    expect(disclosure.getSnapshot().isOpen).toBe(true);

    vi.advanceTimersByTime(2500);
    disclosure.setStreaming(false);

    expect(disclosure.getSnapshot()).toEqual({
      isStreaming: false,
      isOpen: false,
      elapsedSeconds: 2.5,
    });
  });

  it("updates the elapsed time every tick while streaming", () => {
    const disclosure = start();
    const listener = vi.fn();
    disclosure.subscribe(listener);

    vi.advanceTimersByTime(3000);

    expect(disclosure.getSnapshot().elapsedSeconds).toBe(3);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("keeps the user's choice when the stream it was toggled in ends", () => {
    const disclosure = start();
    disclosure.toggle();
    disclosure.toggle();

    disclosure.setStreaming(false);

    expect(disclosure.getSnapshot().isOpen).toBe(true);
  });

  it("opens again and forgets the toggle when a new stream starts", () => {
    const disclosure = start();
    disclosure.toggle();
    disclosure.setStreaming(false);
    expect(disclosure.getSnapshot().isOpen).toBe(false);

    disclosure.setStreaming(true);
    expect(disclosure.getSnapshot().isOpen).toBe(true);
    disclosure.setStreaming(false);
    expect(disclosure.getSnapshot().isOpen).toBe(false);
  });

  it("counts a resumed stream from the first start", () => {
    const disclosure = start();
    vi.advanceTimersByTime(1000);
    disclosure.setStreaming(false);
    vi.advanceTimersByTime(5000);
    disclosure.setStreaming(true);
    vi.advanceTimersByTime(1000);
    disclosure.setStreaming(false);

    expect(disclosure.getSnapshot().elapsedSeconds).toBe(7);
  });

  it("stops ticking on dispose and restarts when a remount streams", () => {
    const disclosure = start();
    disclosure.dispose();
    vi.advanceTimersByTime(3000);
    expect(disclosure.getSnapshot().elapsedSeconds).toBe(0);

    disclosure.setStreaming(true);
    vi.advanceTimersByTime(1000);
    expect(disclosure.getSnapshot().elapsedSeconds).toBe(4);
  });

  it("keeps the same snapshot while nothing changes", () => {
    const disclosure = start(false);
    const before = disclosure.getSnapshot();
    disclosure.setStreaming(false);
    expect(disclosure.getSnapshot()).toBe(before);
  });
});
