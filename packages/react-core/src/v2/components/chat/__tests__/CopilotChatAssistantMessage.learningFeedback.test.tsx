import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AssistantMessage, Message } from "@ag-ui/core";
import type { CopilotKitCore, LearningConfig } from "@copilotkit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { useCopilotKit } from "../../../context";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import {
  MESSAGE_FEEDBACK_EVENT_NAME,
  getMessageFeedback,
  ɵresetMessageFeedbackCache,
} from "../../../lib/message-feedback";
import { FEEDBACK_COMMENT_CLOSE_DELAY_MS } from "../message-feedback";

// The shared setup stubs Radix tooltips; these tests check how the thumbs'
// real tooltips give way to the comment popover.
vi.unmock("@radix-ui/react-tooltip");

const THREAD_ID = "thread-1";
const AGENT_ID = "agent-1";

const reply: AssistantMessage = {
  id: "reply-1",
  role: "assistant",
  content: "The deal is approved.",
};
const messages: Message[] = [
  { id: "user-1", role: "user", content: "Approve the deal" },
  reply,
];

/** The part of a learning sink batch these tests read. */
const batches: { events: { name: string; value: unknown }[] }[] = [];
const learning: LearningConfig = {
  sink: (batch) => {
    batches.push(batch);
  },
  capture: { clicks: false, navigation: false, network: false, inputs: false },
};

function CaptureControls({
  onCore,
}: {
  onCore: (core: CopilotKitCore) => void;
}) {
  onCore(useCopilotKit().copilotkit);
  return null;
}

/** A custom thumb slot named `label` that calls `onClick` without an event. */
const eventlessThumb = (label: string) =>
  function EventlessThumb({
    onClick,
    "aria-pressed": pressed,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
      <button
        type="button"
        aria-pressed={pressed}
        onClick={() => {
          if (onClick) Reflect.apply(onClick, undefined, []);
        }}
      >
        {label}
      </button>
    );
  };
const Like = eventlessThumb("Like");
const Dislike = eventlessThumb("Dislike");

function Chat({
  learningConfig,
  onThumbsDown,
  eventlessThumbs = false,
  showChat = true,
  onCore = () => {},
}: {
  learningConfig?: React.ComponentProps<typeof CopilotKitProvider>["learning"];
  onThumbsDown?: (message: AssistantMessage) => void;
  eventlessThumbs?: boolean;
  showChat?: boolean;
  onCore?: (core: CopilotKitCore) => void;
}) {
  return (
    <CopilotKitProvider learning={learningConfig}>
      <CaptureControls onCore={onCore} />
      <CopilotChatConfigurationProvider threadId={THREAD_ID} agentId={AGENT_ID}>
        {showChat && (
          <CopilotChatMessageView
            messages={messages}
            assistantMessage={{
              ...(onThumbsDown ? { onThumbsDown } : {}),
              ...(eventlessThumbs
                ? { thumbsUpButton: Like, thumbsDownButton: Dislike }
                : {}),
            }}
          />
        )}
      </CopilotChatConfigurationProvider>
      <input aria-label="Elsewhere" />
    </CopilotKitProvider>
  );
}

const thumbsUp = () => screen.getByRole("button", { name: "Good response" });
const thumbsDown = () => screen.getByRole("button", { name: "Bad response" });
const commentBox = () =>
  screen.queryByRole("textbox", { name: "Add a comment (optional)" });
const commentForm = () => screen.getByTestId("copilot-feedback-comment");
/** A pointer click; a keyboard click has `detail` 0. */
const click = (element: HTMLElement) => fireEvent.click(element, { detail: 1 });
/** Runs the hover timers of the comment popover. */
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** Renders the chat with capture on and waits for the Trajectory to start. */
async function renderCapturingChat(
  props: Omit<React.ComponentProps<typeof Chat>, "onCore"> = {},
) {
  let core: CopilotKitCore | undefined;
  const view = render(
    <Chat
      learningConfig={learning}
      {...props}
      onCore={(value) => {
        core = value;
      }}
    />,
  );
  await act(async () => {
    expect(await core!.startTrajectory()).toMatchObject({ status: "started" });
  });
  const emit = vi.spyOn(core!, "emitTrajectoryEvent");
  return { view, core: core!, emit };
}

const feedbackEvents = (emit: { mock: { calls: unknown[][] } }) =>
  emit.mock.calls
    .filter(([name]) => name === MESSAGE_FEEDBACK_EVENT_NAME)
    .map(([, value]) => value);

describe("learning feedback on assistant messages", () => {
  beforeEach(() => {
    localStorage.clear();
    ɵresetMessageFeedbackCache();
    batches.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows no thumbs without learning", () => {
    render(<Chat />);

    expect(screen.queryByRole("button", { name: "Good response" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bad response" })).toBeNull();
  });

  it("shows no thumbs while Learning is set up but capture has not started", () => {
    render(<Chat learningConfig={{ ...learning, autoStart: false }} />);

    expect(screen.queryByRole("button", { name: "Good response" })).toBeNull();
  });

  it("forgets that capture ran once Learning is turned off", async () => {
    const { view } = await renderCapturingChat();
    view.rerender(<Chat learningConfig={learning} showChat={false} />);
    view.rerender(<Chat showChat={false} />);

    view.rerender(<Chat learningConfig={{ ...learning, autoStart: false }} />);

    expect(screen.queryByRole("button", { name: "Good response" })).toBeNull();
  });

  it("sends no reply text when the sink omits agent text", async () => {
    const { core } = await renderCapturingChat({
      learningConfig: {
        ...learning,
        capture: { ...learning.capture, agentText: false },
      },
    });

    click(thumbsUp());
    act(() => core.stopTrajectory());

    const sent = batches
      .flatMap((batch) => batch.events)
      .filter((event) => event.name === MESSAGE_FEEDBACK_EVENT_NAME);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.value).not.toHaveProperty("response");
  });

  it("shows thumbs once a Trajectory captures the chat", async () => {
    await renderCapturingChat();

    expect(thumbsUp().getAttribute("aria-pressed")).toBe("false");
    expect(thumbsDown().getAttribute("aria-pressed")).toBe("false");
  });

  it("records a rating at once and a comment when the user adds one", async () => {
    const { emit } = await renderCapturingChat();

    click(thumbsDown());

    expect(thumbsDown().getAttribute("aria-pressed")).toBe("true");
    expect(feedbackEvents(emit)).toEqual([
      {
        feedbackId: `${THREAD_ID}:${reply.id}`,
        threadId: THREAD_ID,
        messageId: reply.id,
        agentId: AGENT_ID,
        rating: "down",
        response: "The deal is approved.",
      },
    ]);

    // A pointer rating opens the comment without taking focus.
    const input = commentBox();
    expect(input).not.toBeNull();
    expect(document.activeElement).not.toBe(input);
    fireEvent.change(input!, { target: { value: "  Wrong deal  " } });
    fireEvent.submit(input!);

    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit)[1]).toMatchObject({
      feedbackId: `${THREAD_ID}:${reply.id}`,
      rating: "down",
      comment: "Wrong deal",
    });
  });

  it("clicking the chosen thumb again removes the rating", async () => {
    const { emit } = await renderCapturingChat();
    click(thumbsUp());
    click(thumbsDown());

    click(thumbsDown());

    expect(feedbackEvents(emit)).toEqual([
      expect.objectContaining({ rating: "up" }),
      expect.objectContaining({ rating: "down" }),
      expect.objectContaining({ rating: null }),
    ]);
    expect(thumbsUp().getAttribute("aria-pressed")).toBe("false");
    expect(thumbsDown().getAttribute("aria-pressed")).toBe("false");
    expect(commentBox()).toBeNull();
  });

  it("hovering the chosen thumb opens its saved comment at once and leaving closes it", async () => {
    const { emit } = await renderCapturingChat();
    click(thumbsUp());
    fireEvent.change(commentBox()!, { target: { value: "Fast" } });
    fireEvent.submit(commentBox()!);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    fireEvent.pointerEnter(thumbsUp());

    expect(commentBox()).toHaveProperty("value", "Fast");
    expect(thumbsUp().getAttribute("aria-expanded")).toBe("true");

    fireEvent.pointerLeave(thumbsUp());
    wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit)).toHaveLength(2);
  });

  it("passing quickly over the chosen thumb does not leave the comment open", async () => {
    await renderCapturingChat();
    click(thumbsUp());
    fireEvent.keyDown(commentBox()!, { key: "Escape" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const thumb = thumbsUp();

    fireEvent.pointerEnter(thumb);
    fireEvent.pointerLeave(thumb);
    wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);

    // Opening must not replace the button, or its leave event is lost.
    expect(thumbsUp()).toBe(thumb);
    expect(commentBox()).toBeNull();
  });

  it("the thumb's tooltip does not come back after its comment closes", async () => {
    // Real timers: Radix opens tooltips with the window's own timer.
    const pause = (ms: number) =>
      act(() => new Promise<void>((resolve) => window.setTimeout(resolve, ms)));
    // jsdom has no layout, so a positioned popover counts as hidden; ask
    // whether it is open by its test id instead.
    const popoverOpen = () =>
      screen.queryByTestId("copilot-feedback-comment") !== null;
    await renderCapturingChat();
    click(thumbsUp());
    fireEvent.pointerLeave(thumbsUp());
    await waitFor(() => expect(popoverOpen()).toBe(false));

    // The other thumb shows its tooltip as usual.
    fireEvent.pointerMove(thumbsDown());
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Bad response",
    );
    // Escape, not pointerLeave: jsdom pointer events carry no coordinates,
    // which Radix needs to leave an open tooltip. How soon it closes depends
    // on the React version, so wait for it rather than a fixed time.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

    // As in a browser: the pointer enters, then moves over the chosen thumb,
    // which asks its tooltip to open while the comment covers it.
    fireEvent.pointerEnter(thumbsUp());
    fireEvent.pointerMove(thumbsUp());
    await waitFor(() => expect(popoverOpen()).toBe(true));
    // Give a tooltip the time it would need to open before checking it did not.
    await pause(10);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.pointerLeave(thumbsUp());
    await waitFor(() => expect(popoverOpen()).toBe(false));
    await pause(10);

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("moving from the thumb into the popover keeps it open, and an edit saves as it closes", async () => {
    const { emit } = await renderCapturingChat();
    click(thumbsUp());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    fireEvent.pointerLeave(thumbsUp());
    fireEvent.pointerEnter(commentForm());
    wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    expect(commentBox()).not.toBeNull();

    fireEvent.change(commentBox()!, { target: { value: "Fast and right" } });
    fireEvent.pointerLeave(commentForm());
    wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit).at(-1)).toMatchObject({
      rating: "up",
      comment: "Fast and right",
    });
  });

  it("stays open while the user edits, and saves when focus moves on", async () => {
    const { emit } = await renderCapturingChat();
    click(thumbsDown());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const input = commentBox()!;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "Wrong deal" } });

    fireEvent.pointerLeave(commentForm());
    wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    expect(commentBox()).not.toBeNull();

    act(() => screen.getByRole("textbox", { name: "Elsewhere" }).focus());
    wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit).at(-1)).toMatchObject({
      rating: "down",
      comment: "Wrong deal",
    });
  });

  it("Escape closes the popover and discards an unsaved change", async () => {
    const { emit } = await renderCapturingChat();
    click(thumbsUp());
    fireEvent.change(commentBox()!, { target: { value: "Never mind" } });

    fireEvent.keyDown(commentBox()!, { key: "Escape" });

    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit)).toHaveLength(1);
  });

  it("a keyboard rating moves focus into the comment", async () => {
    await renderCapturingChat();

    fireEvent.click(thumbsUp(), { detail: 0 });

    expect(document.activeElement).toBe(commentBox());
  });

  it("restores the saved rating and comment after a reload", async () => {
    const first = await renderCapturingChat();
    click(thumbsUp());
    fireEvent.change(commentBox()!, { target: { value: "good" } });
    fireEvent.submit(commentBox()!);
    first.view.unmount();

    ɵresetMessageFeedbackCache();
    await renderCapturingChat();

    expect(thumbsUp().getAttribute("aria-pressed")).toBe("true");
    expect(commentBox()).toBeNull();
    fireEvent.pointerEnter(thumbsUp());
    expect(commentBox()).toHaveProperty("value", "good");
  });

  it("still calls the app's own handler", async () => {
    const onThumbsDown = vi.fn();
    const { emit } = await renderCapturingChat({ onThumbsDown });

    click(thumbsDown());

    expect(onThumbsDown).toHaveBeenCalledWith(
      expect.objectContaining({ id: reply.id }),
    );
    expect(feedbackEvents(emit)).toHaveLength(1);
  });

  it("delivers the rating to the learning sink", async () => {
    const { core } = await renderCapturingChat();

    click(thumbsDown());
    act(() => core.stopTrajectory());

    const events = batches.flatMap((batch) => batch.events);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "CUSTOM",
        name: MESSAGE_FEEDBACK_EVENT_NAME,
        value: expect.objectContaining({
          messageId: reply.id,
          rating: "down",
        }),
      }),
    );
  });

  it("sends a rating given while capture is stopped once it runs again", async () => {
    const { core, emit } = await renderCapturingChat();
    act(() => core.stopTrajectory());

    click(thumbsUp());
    click(thumbsDown());
    expect(thumbsDown().getAttribute("aria-pressed")).toBe("true");
    expect(feedbackEvents(emit)).toEqual([]);

    await act(async () => {
      await core.startTrajectory();
    });

    // Only the newest change of each message goes out.
    expect(feedbackEvents(emit)).toEqual([
      expect.objectContaining({ messageId: reply.id, rating: "down" }),
    ]);
  });

  it("keeps the thumbs after capture stops", async () => {
    const { core } = await renderCapturingChat();

    act(() => core.stopTrajectory());

    expect(thumbsUp()).toBeTruthy();
  });

  it("shows the thumbs in a chat that opens after capture stopped", async () => {
    const { core, view } = await renderCapturingChat();
    view.rerender(<Chat learningConfig={learning} showChat={false} />);
    act(() => core.stopTrajectory());

    view.rerender(<Chat learningConfig={learning} />);

    expect(thumbsUp()).toBeTruthy();
  });

  it("sends a rating that waited when the page is opened again", async () => {
    const first = await renderCapturingChat();
    act(() => first.core.stopTrajectory());
    click(thumbsDown());
    first.view.unmount();
    ɵresetMessageFeedbackCache();
    batches.length = 0;

    const second = await renderCapturingChat();
    act(() => second.core.stopTrajectory());

    const sent = batches
      .flatMap((batch) => batch.events)
      .filter((event) => event.name === MESSAGE_FEEDBACK_EVENT_NAME);
    expect(sent).toEqual([
      expect.objectContaining({
        value: expect.objectContaining({ messageId: reply.id, rating: "down" }),
      }),
    ]);
  });

  it("keeps working when storage is blocked", async () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    const { emit } = await renderCapturingChat();

    click(thumbsUp());

    expect(setItem).toHaveBeenCalled();
    expect(thumbsUp().getAttribute("aria-pressed")).toBe("true");
    expect(feedbackEvents(emit)).toHaveLength(1);
  });

  it("does not tell the app about a rating that is removed", async () => {
    const onThumbsDown = vi.fn();
    await renderCapturingChat({ onThumbsDown });

    click(thumbsDown());
    click(thumbsDown());

    expect(onThumbsDown).toHaveBeenCalledTimes(1);
    expect(thumbsDown().getAttribute("aria-pressed")).toBe("false");
  });

  it("works with a custom thumb that calls onClick without an event", async () => {
    const { emit } = await renderCapturingChat({ eventlessThumbs: true });

    fireEvent.click(screen.getByRole("button", { name: "Like" }));

    expect(feedbackEvents(emit)).toEqual([
      expect.objectContaining({ rating: "up" }),
    ]);
    expect(commentBox()).not.toBeNull();
  });

  it("points the comment at the custom thumb that was chosen", async () => {
    await renderCapturingChat({ eventlessThumbs: true });
    const dislike = screen.getByRole("button", { name: "Dislike" });

    fireEvent.click(dislike);
    act(() => commentBox()!.focus());
    fireEvent.keyDown(commentBox()!, { key: "Escape" });

    // Escape from the field returns focus to the thumb it points at.
    expect(document.activeElement).toBe(dislike);
  });

  it("a click on a thumb while the comment is open does not send the draft", async () => {
    const { emit } = await renderCapturingChat();
    click(thumbsUp());
    fireEvent.change(commentBox()!, { target: { value: "half a thought" } });
    // Radix starts listening for outside presses one tick after it opens.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

    fireEvent.pointerDown(thumbsUp());
    click(thumbsUp());

    expect(feedbackEvents(emit)).toEqual([
      expect.objectContaining({ rating: "up" }),
      expect.objectContaining({ rating: null }),
    ]);
  });

  it("Escape elsewhere closes the comment without taking focus", async () => {
    await renderCapturingChat();
    click(thumbsUp());
    fireEvent.keyDown(commentBox()!, { key: "Escape" });
    const elsewhere = screen.getByRole("textbox", { name: "Elsewhere" });
    act(() => elsewhere.focus());
    // Hovering the thumb opens the comment while focus stays elsewhere.
    fireEvent.pointerEnter(thumbsUp());
    expect(commentBox()).not.toBeNull();

    fireEvent.keyDown(elsewhere, { key: "Escape" });

    expect(commentBox()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("Enter saves the comment and returns focus to the thumb", async () => {
    await renderCapturingChat();
    fireEvent.click(thumbsUp(), { detail: 0 });
    fireEvent.change(commentBox()!, { target: { value: "Clear" } });

    fireEvent.submit(commentBox()!);

    expect(commentBox()).toBeNull();
    expect(document.activeElement).toBe(thumbsUp());
  });

  it("Shift+Tab from the comment returns to the thumb, Tab moves past it", async () => {
    await renderCapturingChat();
    fireEvent.click(thumbsUp(), { detail: 0 });

    fireEvent.keyDown(commentBox()!, { key: "Tab", shiftKey: true });
    expect(commentBox()).toBeNull();
    expect(document.activeElement).toBe(thumbsUp());

    fireEvent.click(thumbsDown(), { detail: 0 });
    fireEvent.keyDown(commentBox()!, { key: "Tab" });
    expect(commentBox()).toBeNull();
    // The control after the thumbs-down button in page order.
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Elsewhere" }),
    );
  });

  it("a keyboard switch to the other thumb moves focus into its comment", async () => {
    await renderCapturingChat();
    fireEvent.click(thumbsUp(), { detail: 0 });

    fireEvent.click(thumbsDown(), { detail: 0 });

    expect(thumbsDown().getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(commentBox());
  });

  it("Escape in the comment does not reach the page around the chat", async () => {
    await renderCapturingChat();
    click(thumbsUp());
    const pageEscape = vi.fn();
    window.addEventListener("keydown", pageEscape);
    try {
      act(() => commentBox()!.focus());
      fireEvent.keyDown(commentBox()!, { key: "Escape" });
    } finally {
      window.removeEventListener("keydown", pageEscape);
    }

    expect(commentBox()).toBeNull();
    expect(pageEscape).not.toHaveBeenCalled();
  });

  it("moving focus to the popover around the field keeps it open", async () => {
    await renderCapturingChat();
    click(thumbsUp());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => commentBox()!.focus());
    fireEvent.pointerEnter(commentForm());
    // As in a browser; jsdom reports no page focus while focus moves.
    vi.spyOn(document, "hasFocus").mockReturnValue(true);

    const popover = document.querySelector<HTMLElement>(
      '[data-slot="popover-content"]',
    )!;
    expect(popover.hasAttribute("data-copilotkit-popover")).toBe(true);
    act(() => popover.focus());
    expect(document.activeElement).toBe(popover);
    wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(commentBox()).not.toBeNull();
  });

  it("sends an unsaved comment when its message unmounts", async () => {
    const { view, emit } = await renderCapturingChat();
    click(thumbsUp());
    fireEvent.change(commentBox()!, { target: { value: "Keep me" } });

    view.rerender(<Chat learningConfig={learning} showChat={false} />);

    expect(feedbackEvents(emit).at(-1)).toMatchObject({
      rating: "up",
      comment: "Keep me",
    });
    expect(getMessageFeedback(AGENT_ID, THREAD_ID, reply.id)).toEqual({
      rating: "up",
      comment: "Keep me",
    });
  });

  it("switching to another window does not save a half-typed comment", async () => {
    const { emit } = await renderCapturingChat();
    click(thumbsUp());
    const input = commentBox()!;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "half" } });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    fireEvent.blur(input, { relatedTarget: null });
    wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    // The pointer may leave while the user is in the other window.
    fireEvent.pointerLeave(commentForm());
    wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(commentBox()).not.toBeNull();
    expect(feedbackEvents(emit)).toHaveLength(1);
  });

  it("shows a rating changed in another tab", async () => {
    await renderCapturingChat();
    const key = `copilotkit:message-feedback:v1:${JSON.stringify([AGENT_ID, THREAD_ID])}`;
    const value = JSON.stringify({ [reply.id]: { rating: "down" } });
    localStorage.setItem(key, value);

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key, newValue: value }),
      );
    });

    expect(thumbsDown().getAttribute("aria-pressed")).toBe("true");
  });

  it("closes the comment when another tab removes the rating", async () => {
    const { emit } = await renderCapturingChat();
    click(thumbsUp());
    fireEvent.change(commentBox()!, { target: { value: "Fast" } });
    fireEvent.submit(commentBox()!);
    fireEvent.pointerEnter(thumbsUp());
    expect(commentBox()).toHaveProperty("value", "Fast");
    const key = `copilotkit:message-feedback:v1:${JSON.stringify([AGENT_ID, THREAD_ID])}`;
    const sync = (value: string | null) => {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      act(() => {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key,
            newValue: value,
            storageArea: localStorage,
          }),
        );
      });
    };

    sync(null);
    expect(thumbsUp().getAttribute("aria-pressed")).toBe("false");
    expect(commentBox()).toBeNull();

    // Rated again there, the comment that was open does not reopen by itself.
    sync(JSON.stringify({ [reply.id]: { rating: "up", comment: "Fast" } }));
    expect(thumbsUp().getAttribute("aria-pressed")).toBe("true");
    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit)).toHaveLength(2);
  });

  it("does not save a draft for a rating another tab changed", async () => {
    const { emit } = await renderCapturingChat();
    click(thumbsUp());
    fireEvent.change(commentBox()!, { target: { value: "Fast" } });
    const key = `copilotkit:message-feedback:v1:${JSON.stringify([AGENT_ID, THREAD_ID])}`;
    const value = JSON.stringify({ [reply.id]: { rating: "down" } });
    localStorage.setItem(key, value);

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: value,
          storageArea: localStorage,
        }),
      );
    });

    expect(thumbsDown().getAttribute("aria-pressed")).toBe("true");
    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit)).toHaveLength(1);
  });

  it("stays open while focus is on the send button", async () => {
    await renderCapturingChat();
    click(thumbsUp());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    act(() => commentBox()!.focus());
    fireEvent.change(commentBox()!, { target: { value: "Fast" } });

    act(() => screen.getByRole("button", { name: "Send comment" }).focus());
    fireEvent.pointerLeave(commentForm());
    wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(commentBox()).not.toBeNull();
  });
  it("stays open when focus leaves for nothing while the pointer is on the thumb", async () => {
    const { emit } = await renderCapturingChat();
    click(thumbsUp());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    act(() => commentBox()!.focus());
    fireEvent.change(commentBox()!, { target: { value: "half" } });
    fireEvent.pointerEnter(thumbsUp());

    // Safari and Firefox on macOS do not focus a pressed button.
    fireEvent.blur(commentBox()!, { relatedTarget: null });
    wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    expect(commentBox()).not.toBeNull();

    fireEvent.pointerLeave(thumbsUp());
    wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit).at(-1)).toMatchObject({ comment: "half" });
  });

  it("stays open when the focused thumb blurs while the pointer is on the popover", async () => {
    await renderCapturingChat();
    click(thumbsUp());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.pointerEnter(commentForm());

    fireEvent.blur(thumbsUp());
    wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(commentBox()).not.toBeNull();
  });
});
