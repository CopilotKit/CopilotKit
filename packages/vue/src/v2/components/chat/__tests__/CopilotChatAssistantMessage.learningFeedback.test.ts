import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import type { PropType } from "vue";
import { fireEvent, render, screen } from "@testing-library/vue";
import type { AssistantMessage, Message } from "@ag-ui/core";
import type { CopilotKitCore, LearningConfig } from "@copilotkit/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import { useCopilotKit } from "../../../providers/useCopilotKit";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";
import {
  MESSAGE_FEEDBACK_EVENT_NAME,
  getMessageFeedback,
  setMessageFeedback,
  ɵresetMessageFeedbackCache,
} from "../../../lib/message-feedback";
import { FEEDBACK_COMMENT_CLOSE_DELAY_MS } from "../message-feedback";

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

let core: CopilotKitCore | undefined;

const CaptureControls = defineComponent({
  setup() {
    core = useCopilotKit().copilotkit.value;
    return () => null;
  },
});

/** A custom thumb slot named `label` that calls its handler without an event. */
const eventlessThumb =
  (label: string, handler: "onThumbsUp" | "onThumbsDown") =>
  (slotProps: Record<string, unknown>) =>
    h(
      "button",
      {
        type: "button",
        "aria-pressed": slotProps.pressed ? "true" : "false",
        onClick: () => (slotProps[handler] as () => void)(),
      },
      label,
    );

const showChat = ref(true);

const Chat = defineComponent({
  props: {
    onThumbsDown: Function as PropType<(message: AssistantMessage) => void>,
    eventlessThumbs: Boolean,
    messageFeedback: { type: Boolean, default: undefined },
    customComment: Boolean,
  },
  setup(props) {
    return () =>
      h(CopilotKitProvider, null, {
        default: () => [
          h(CaptureControls),
          h(
            CopilotChatConfigurationProvider,
            { threadId: THREAD_ID, agentId: AGENT_ID },
            {
              default: () =>
                showChat.value
                  ? h(
                      CopilotChatMessageView,
                      {
                        messages,
                        ...(props.messageFeedback === undefined
                          ? {}
                          : { messageFeedback: props.messageFeedback }),
                      },
                      {
                        "assistant-message": ({
                          message,
                        }: {
                          message: AssistantMessage;
                        }) =>
                          h(
                            CopilotChatAssistantMessage,
                            {
                              message,
                              messages,
                              ...(props.onThumbsDown
                                ? { onThumbsDown: props.onThumbsDown }
                                : {}),
                            },
                            {
                              ...(props.eventlessThumbs
                                ? {
                                    "thumbs-up-button": eventlessThumb(
                                      "Like",
                                      "onThumbsUp",
                                    ),
                                    "thumbs-down-button": eventlessThumb(
                                      "Dislike",
                                      "onThumbsDown",
                                    ),
                                  }
                                : {}),
                              ...(props.customComment
                                ? {
                                    "feedback-comment": (
                                      slotProps: Record<string, unknown>,
                                    ) =>
                                      h("form", {
                                        "data-testid": "custom-comment",
                                        "data-value": slotProps.value,
                                      }),
                                  }
                                : {}),
                            },
                          ),
                      },
                    )
                  : null,
            },
          ),
          h("input", { "aria-label": "Elsewhere" }),
        ],
      });
  },
});

const thumbsUp = () => screen.getByRole("button", { name: "Good response" });
const thumbsDown = () => screen.getByRole("button", { name: "Bad response" });
const commentBox = () =>
  screen.queryByRole<HTMLInputElement>("textbox", {
    name: "Add a comment (optional)",
  });
const commentForm = () => screen.getByTestId("copilot-feedback-comment");
/** A pointer click; a keyboard click has `detail` 0. */
const click = (element: HTMLElement) => fireEvent.click(element, { detail: 1 });
const keyboardClick = (element: HTMLElement) =>
  fireEvent.click(element, { detail: 0 });
/** Runs the hover timers of the comment popover. */
const wait = async (ms: number) => {
  vi.advanceTimersByTime(ms);
  await nextTick();
  await nextTick();
};
/** Lets the popover's open and close (and its exit animation check) settle. */
const settle = async () => {
  for (let i = 0; i < 4; i++) await nextTick();
};
const type = async (value: string) => {
  await fireEvent.update(commentBox()!, value);
};

/** Renders the chat, turns capture on, and waits for the Trajectory to start. */
async function renderCapturingChat(
  props: Record<string, unknown> = {},
  config: LearningConfig = learning,
) {
  const view = render(Chat, { props });
  core!.setLearningConfig(config);
  expect(await core!.startTrajectory()).toMatchObject({ status: "started" });
  await settle();
  const emit = vi.spyOn(core!, "emitTrajectoryEvent");
  return { view, core: core!, emit };
}

/** Changes the reply's rating the way another chat of this Thread would. */
const rateElsewhere = async (
  copilotkit: CopilotKitCore,
  feedback: { rating: "up" | "down"; comment?: string } | null,
) => {
  setMessageFeedback({
    copilotkit,
    agentId: AGENT_ID,
    threadId: THREAD_ID,
    message: reply,
    feedback,
  });
  await settle();
};

const feedbackEvents = (emit: { mock: { calls: unknown[][] } }) =>
  emit.mock.calls
    .filter(([name]) => name === MESSAGE_FEEDBACK_EVENT_NAME)
    .map(([, value]) => value);

describe("learning feedback on assistant messages", () => {
  beforeEach(() => {
    ɵresetMessageFeedbackCache();
    batches.length = 0;
    showChat.value = true;
  });
  afterEach(() => {
    core?.stopTrajectory();
    core?.setLearningConfig(undefined);
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("shows no thumbs without learning", () => {
    render(Chat);

    expect(screen.queryByRole("button", { name: "Good response" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bad response" })).toBeNull();
  });

  it("shows no thumbs while Learning is set up but capture has not started", async () => {
    render(Chat);
    core!.setLearningConfig(learning);
    await settle();

    expect(screen.queryByRole("button", { name: "Good response" })).toBeNull();
  });

  it("shows thumbs once a Trajectory captures the chat", async () => {
    await renderCapturingChat();

    expect(thumbsUp().getAttribute("aria-pressed")).toBe("false");
    expect(thumbsDown().getAttribute("aria-pressed")).toBe("false");
  });

  it("sends no reply text when the sink omits agent text", async () => {
    const { core } = await renderCapturingChat(
      {},
      { ...learning, capture: { ...learning.capture, agentText: false } },
    );

    await click(thumbsUp());
    core.stopTrajectory();

    const sent = batches
      .flatMap((batch) => batch.events)
      .filter((event) => event.name === MESSAGE_FEEDBACK_EVENT_NAME);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.value).not.toHaveProperty("response");
  });

  it("records a rating at once and a comment when the user adds one", async () => {
    const { emit } = await renderCapturingChat();

    await click(thumbsDown());
    await settle();

    expect(thumbsDown().getAttribute("aria-pressed")).toBe("true");
    expect(thumbsDown().getAttribute("aria-haspopup")).toBe("dialog");
    expect(thumbsDown().getAttribute("aria-expanded")).toBe("true");
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
    const popover = input!.closest('[data-slot="popover-content"]')!;
    expect(popover.getAttribute("role")).toBe("dialog");
    expect(popover.getAttribute("aria-label")).toBe("Add a comment (optional)");
    expect(popover.hasAttribute("data-copilotkit-ignore")).toBe(true);
    await type("  Wrong deal  ");
    await fireEvent.submit(commentForm());
    await settle();

    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit)[1]).toMatchObject({
      feedbackId: `${THREAD_ID}:${reply.id}`,
      rating: "down",
      comment: "Wrong deal",
    });
  });

  it("clicking the chosen thumb again removes the rating", async () => {
    const { emit } = await renderCapturingChat();
    await click(thumbsUp());
    await click(thumbsDown());

    await click(thumbsDown());
    await settle();

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
    await click(thumbsUp());
    await type("Fast");
    await fireEvent.submit(commentForm());
    await settle();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    await fireEvent.pointerEnter(thumbsUp());

    expect(commentBox()).toHaveProperty("value", "Fast");
    expect(thumbsUp().getAttribute("aria-expanded")).toBe("true");

    await fireEvent.pointerLeave(thumbsUp());
    await wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    await settle();

    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit)).toHaveLength(2);
  });

  it("the thumb's tooltip gives way to its comment", async () => {
    await renderCapturingChat();
    await fireEvent.pointerMove(thumbsDown());
    expect(screen.getByRole("tooltip").textContent).toContain("Bad response");
    await fireEvent.pointerLeave(thumbsDown());

    await click(thumbsUp());
    await fireEvent.pointerEnter(thumbsUp());
    await fireEvent.pointerMove(thumbsUp());
    await settle();

    expect(commentBox()).not.toBeNull();
    expect(
      screen
        .queryAllByRole("tooltip")
        .some((tooltip) => tooltip.textContent?.includes("Good response")),
    ).toBe(false);
  });

  it("moving from the thumb into the popover keeps it open, and an edit saves as it closes", async () => {
    const { emit } = await renderCapturingChat();
    await click(thumbsUp());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    await fireEvent.pointerLeave(thumbsUp());
    await fireEvent.pointerEnter(commentForm().parentElement!);
    await wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    expect(commentBox()).not.toBeNull();

    await type("Fast and right");
    await fireEvent.pointerLeave(commentForm().parentElement!);
    await wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    await settle();

    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit).at(-1)).toMatchObject({
      rating: "up",
      comment: "Fast and right",
    });
  });

  it("stays open while the user edits, and saves when focus moves on", async () => {
    const { emit } = await renderCapturingChat();
    await click(thumbsDown());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    commentBox()!.focus();
    await type("Wrong deal");

    await fireEvent.pointerLeave(commentForm().parentElement!);
    await wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    expect(commentBox()).not.toBeNull();

    screen.getByRole("textbox", { name: "Elsewhere" }).focus();
    await wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    await settle();

    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit).at(-1)).toMatchObject({
      rating: "down",
      comment: "Wrong deal",
    });
  });

  it("Escape closes the popover and discards an unsaved change", async () => {
    const { emit } = await renderCapturingChat();
    await click(thumbsUp());
    await type("Never mind");

    await fireEvent.keyDown(commentBox()!, { key: "Escape" });
    await settle();

    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit)).toHaveLength(1);
  });

  it("a keyboard rating moves focus into the comment", async () => {
    await renderCapturingChat();

    await keyboardClick(thumbsUp());
    await settle();

    expect(document.activeElement).toBe(commentBox());
  });

  it("shows the rating and comment again when the chat mounts again", async () => {
    await renderCapturingChat();
    await click(thumbsUp());
    await type("good");
    await fireEvent.submit(commentForm());
    showChat.value = false;
    await settle();

    showChat.value = true;
    await settle();

    expect(thumbsUp().getAttribute("aria-pressed")).toBe("true");
    expect(commentBox()).toBeNull();
    await fireEvent.pointerEnter(thumbsUp());
    expect(commentBox()).toHaveProperty("value", "good");
  });

  it("still calls the app's own handler", async () => {
    const onThumbsDown = vi.fn();
    const { emit } = await renderCapturingChat({ onThumbsDown });

    await click(thumbsDown());

    expect(onThumbsDown).toHaveBeenCalledWith(
      expect.objectContaining({ id: reply.id }),
    );
    expect(feedbackEvents(emit)).toHaveLength(1);
  });

  it("does not tell the app about a rating that is removed", async () => {
    const onThumbsDown = vi.fn();
    await renderCapturingChat({ onThumbsDown });

    await click(thumbsDown());
    await click(thumbsDown());

    expect(onThumbsDown).toHaveBeenCalledTimes(1);
    expect(thumbsDown().getAttribute("aria-pressed")).toBe("false");
  });

  it("delivers the rating to the learning sink", async () => {
    const { core } = await renderCapturingChat();

    await click(thumbsDown());
    core.stopTrajectory();

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

  it("keeps the thumbs after capture stops", async () => {
    const { core } = await renderCapturingChat();

    core.stopTrajectory();
    await settle();

    expect(thumbsUp()).toBeTruthy();
  });

  it("leaves the thumbs to the app when the message view turns ratings off", async () => {
    const onThumbsDown = vi.fn();
    const { emit } = await renderCapturingChat({
      messageFeedback: false,
      onThumbsDown,
    });

    expect(screen.queryByRole("button", { name: "Good response" })).toBeNull();
    await click(thumbsDown());

    expect(onThumbsDown).toHaveBeenCalledTimes(1);
    expect(feedbackEvents(emit)).toEqual([]);
    expect(commentBox()).toBeNull();
  });

  it("renders the comment field from the feedback-comment slot", async () => {
    await renderCapturingChat({ customComment: true });

    await click(thumbsUp());
    await settle();

    expect(screen.getByTestId("custom-comment")).toBeTruthy();
    expect(commentBox()).toBeNull();
  });

  it("works with a custom thumb that calls its handler without an event", async () => {
    const { emit } = await renderCapturingChat({ eventlessThumbs: true });

    await fireEvent.click(screen.getByRole("button", { name: "Like" }));
    await settle();

    expect(feedbackEvents(emit)).toEqual([
      expect.objectContaining({ rating: "up" }),
    ]);
    expect(commentBox()).not.toBeNull();
  });

  it("points the comment at the custom thumb that was chosen", async () => {
    await renderCapturingChat({ eventlessThumbs: true });
    const dislike = screen.getByRole("button", { name: "Dislike" });

    await fireEvent.click(dislike);
    await settle();
    commentBox()!.focus();
    await fireEvent.keyDown(commentBox()!, { key: "Escape" });

    // Escape from the field returns focus to the thumb it points at.
    expect(document.activeElement).toBe(dislike);
  });

  it("a click on a thumb while the comment is open does not send the draft", async () => {
    const { emit } = await renderCapturingChat();
    await click(thumbsUp());
    await type("half a thought");

    await fireEvent.pointerDown(thumbsUp());
    await click(thumbsUp());

    expect(feedbackEvents(emit)).toEqual([
      expect.objectContaining({ rating: "up" }),
      expect.objectContaining({ rating: null }),
    ]);
  });

  it("Escape elsewhere closes the comment without taking focus", async () => {
    await renderCapturingChat();
    await click(thumbsUp());
    await fireEvent.keyDown(commentBox()!, { key: "Escape" });
    await settle();
    const elsewhere = screen.getByRole("textbox", { name: "Elsewhere" });
    elsewhere.focus();
    // Hovering the thumb opens the comment while focus stays elsewhere.
    await fireEvent.pointerEnter(thumbsUp());
    expect(commentBox()).not.toBeNull();

    await fireEvent.keyDown(elsewhere, { key: "Escape" });
    await settle();

    expect(commentBox()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("Enter saves the comment and returns focus to the thumb", async () => {
    await renderCapturingChat();
    await keyboardClick(thumbsUp());
    await settle();
    await type("Clear");

    await fireEvent.submit(commentForm());
    await settle();

    expect(commentBox()).toBeNull();
    expect(document.activeElement).toBe(thumbsUp());
  });

  it("Shift+Tab from the comment returns to the thumb, Tab moves past it", async () => {
    await renderCapturingChat();
    await keyboardClick(thumbsUp());
    await settle();

    await fireEvent.keyDown(commentBox()!, { key: "Tab", shiftKey: true });
    await settle();
    expect(commentBox()).toBeNull();
    expect(document.activeElement).toBe(thumbsUp());

    await keyboardClick(thumbsDown());
    await settle();
    await fireEvent.keyDown(commentBox()!, { key: "Tab" });
    await settle();
    expect(commentBox()).toBeNull();
    // The control after the thumbs-down button in page order.
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Elsewhere" }),
    );
  });

  it("a keyboard switch to the other thumb moves focus into its comment", async () => {
    await renderCapturingChat();
    await keyboardClick(thumbsUp());
    await settle();

    await keyboardClick(thumbsDown());
    await settle();

    expect(thumbsDown().getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(commentBox());
  });

  it("Escape in the comment does not reach the page around the chat", async () => {
    await renderCapturingChat();
    await click(thumbsUp());
    const pageEscape = vi.fn();
    window.addEventListener("keydown", pageEscape);
    try {
      commentBox()!.focus();
      await fireEvent.keyDown(commentBox()!, { key: "Escape" });
    } finally {
      window.removeEventListener("keydown", pageEscape);
    }
    await settle();

    expect(commentBox()).toBeNull();
    expect(pageEscape).not.toHaveBeenCalled();
  });

  it("sends an unsaved comment when its message unmounts", async () => {
    const { emit } = await renderCapturingChat();
    await click(thumbsUp());
    await type("Keep me");

    showChat.value = false;
    await settle();

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
    await click(thumbsUp());
    const input = commentBox()!;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await fireEvent.focusIn(input);
    await type("half");
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    await fireEvent.focusOut(input, { relatedTarget: null });
    await wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    // The pointer may leave while the user is in the other window.
    await fireEvent.pointerLeave(commentForm().parentElement!);
    await wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(commentBox()).not.toBeNull();
    expect(feedbackEvents(emit)).toHaveLength(1);
  });

  it("shows a rating changed elsewhere on the page", async () => {
    const { core } = await renderCapturingChat();

    await rateElsewhere(core, { rating: "down" });

    expect(thumbsDown().getAttribute("aria-pressed")).toBe("true");
  });

  it("closes the comment when the rating is removed elsewhere on the page", async () => {
    const { core, emit } = await renderCapturingChat();
    await click(thumbsUp());
    await type("Fast");
    await fireEvent.submit(commentForm());
    await settle();
    await fireEvent.pointerEnter(thumbsUp());
    expect(commentBox()).toHaveProperty("value", "Fast");

    await rateElsewhere(core, null);
    expect(thumbsUp().getAttribute("aria-pressed")).toBe("false");
    expect(commentBox()).toBeNull();

    // Rated again there, the comment that was open does not reopen by itself.
    await rateElsewhere(core, { rating: "up", comment: "Fast" });
    expect(thumbsUp().getAttribute("aria-pressed")).toBe("true");
    expect(commentBox()).toBeNull();
    // The two changes from this chat, then the two from elsewhere.
    expect(feedbackEvents(emit)).toHaveLength(4);
  });

  it("does not save a draft for a rating changed elsewhere on the page", async () => {
    const { core, emit } = await renderCapturingChat();
    await click(thumbsUp());
    await type("Fast");

    await rateElsewhere(core, { rating: "down" });

    expect(thumbsDown().getAttribute("aria-pressed")).toBe("true");
    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit)).toEqual([
      expect.objectContaining({ rating: "up" }),
      expect.objectContaining({ rating: "down" }),
    ]);
  });

  it("stays open while focus is on the send button", async () => {
    await renderCapturingChat();
    await click(thumbsUp());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    commentBox()!.focus();
    await type("Fast");

    screen.getByRole("button", { name: "Send comment" }).focus();
    await fireEvent.pointerLeave(commentForm().parentElement!);
    await wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(commentBox()).not.toBeNull();
  });

  it("stays open when focus leaves for nothing while the pointer is on the thumb", async () => {
    const { emit } = await renderCapturingChat();
    await click(thumbsUp());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    commentBox()!.focus();
    await type("half");
    await fireEvent.pointerEnter(thumbsUp());

    // Safari and Firefox on macOS do not focus a pressed button.
    await fireEvent.focusOut(commentBox()!, { relatedTarget: null });
    await wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    expect(commentBox()).not.toBeNull();

    await fireEvent.pointerLeave(thumbsUp());
    await wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);
    await settle();
    expect(commentBox()).toBeNull();
    expect(feedbackEvents(emit).at(-1)).toMatchObject({ comment: "half" });
  });

  it("stays open when the focused thumb blurs while the pointer is on the popover", async () => {
    await renderCapturingChat();
    await click(thumbsUp());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await fireEvent.pointerEnter(commentForm().parentElement!);

    await fireEvent.blur(thumbsUp());
    await wait(FEEDBACK_COMMENT_CLOSE_DELAY_MS);

    expect(commentBox()).not.toBeNull();
  });
});
