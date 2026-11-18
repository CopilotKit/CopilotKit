// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ɵFeedbackCommentController,
  ɵisOwnFeedbackThumb,
} from "../message-feedback";
import type {
  ɵMessageFeedback,
  ɵMessageFeedbackControls,
  ɵMessageFeedbackRating,
} from "../message-feedback";

const byId = (id: string) => document.getElementById(id)!;

/**
 * A message whose ratings are kept in memory, its rendered thumbs, and a
 * comment popover with one field and one button.
 */
function setup(initial?: ɵMessageFeedback) {
  document.body.innerHTML = `
    <div data-message-id="m1">
      <button id="up" data-copilotkit-rating="up">Up</button>
      <button id="down" data-copilotkit-rating="down">Down</button>
      <button id="after">Read aloud</button>
    </div>
    <div id="popover"><input id="field" /><button id="send">Send</button></div>
  `;
  let feedback = initial;
  const saved: (ɵMessageFeedback | null)[] = [];
  const controls = (): ɵMessageFeedbackControls => ({
    feedback,
    rate: (rating) => {
      feedback = { rating };
      saved.push(feedback);
    },
    clear: () => {
      feedback = undefined;
      saved.push(null);
    },
    comment: (comment) => {
      if (feedback) feedback = { rating: feedback.rating, comment };
      saved.push(feedback ?? null);
    },
  });
  const controller = new ɵFeedbackCommentController({
    getControls: controls,
    getInput: () => byId("field"),
  });
  return {
    controller,
    saved,
    setRating: (rating: ɵMessageFeedbackRating | undefined) => {
      feedback = rating ? { rating } : undefined;
    },
  };
}

const tab = (shiftKey = false) => ({
  key: "Tab",
  shiftKey,
  preventDefault: vi.fn(),
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ɵFeedbackCommentController thumbs", () => {
  it("rates, opens the comment at the clicked thumb, and lets the app hear it", () => {
    const { controller, saved } = setup();

    const notifyApp = controller.rate("up", { target: byId("up") });

    expect(notifyApp).toBe(true);
    expect(saved).toEqual([{ rating: "up" }]);
    expect(controller.getSnapshot()).toMatchObject({
      open: true,
      draft: "",
      anchor: byId("up"),
    });
  });

  it("removes the rating when the chosen thumb is clicked again", () => {
    const { controller, saved } = setup({ rating: "up" });

    expect(controller.rate("up")).toBe(false);

    expect(saved).toEqual([null]);
    expect(controller.getSnapshot().open).toBe(false);
  });

  it("asks to focus the field for a keyboard rating", () => {
    const { controller } = setup();
    controller.rate("down", { keyboard: true });

    controller.focusField();

    expect(document.activeElement).toBe(byId("field"));
    // The request is answered once.
    byId("after").focus();
    controller.focusField();
    expect(document.activeElement).toBe(byId("after"));
  });

  it("lets the app handle thumbs while the chat records no ratings", () => {
    const controller = new ɵFeedbackCommentController({
      getControls: () => null,
    });
    expect(controller.rate("up")).toBe(true);
    expect(controller.thumb("up")).toBeNull();
  });

  it("marks only the chosen thumb as pressed and as opening the comment", () => {
    const { controller } = setup({ rating: "down" });

    expect(controller.thumb("up")).toEqual({
      attributes: { "data-copilotkit-rating": "up", "aria-pressed": false },
      handlers: null,
    });
    expect(controller.thumb("down")?.attributes).toEqual({
      "data-copilotkit-rating": "down",
      "aria-pressed": true,
      "aria-haspopup": "dialog",
      "aria-expanded": false,
    });
  });

  it("opens the comment when the pointer reaches the chosen thumb, not on touch", () => {
    const { controller } = setup({ rating: "up" });
    const handlers = controller.thumb("up")!.handlers!;

    handlers.pointerEnter({ currentTarget: byId("up"), pointerType: "touch" });
    expect(controller.getSnapshot().open).toBe(false);

    handlers.pointerEnter({ currentTarget: byId("up"), pointerType: "mouse" });
    expect(controller.getSnapshot()).toMatchObject({
      open: true,
      anchor: byId("up"),
    });
  });

  it("moves Tab from the chosen thumb into the open comment field", () => {
    const { controller } = setup({ rating: "up" });
    controller.rate("down");
    const event = tab();

    controller.thumb("down")!.handlers!.keyDown(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(byId("field"));
  });

  it("finds the chosen thumb when the click gave no element", () => {
    const { controller } = setup();
    controller.rate("down");
    expect(controller.getSnapshot().anchor).toBeNull();

    controller.findAnchor(document.body);

    expect(controller.getSnapshot().anchor).toBe(byId("down"));
  });
});

describe("ɵFeedbackCommentController sync", () => {
  it("discards the comment when the rating changes elsewhere", () => {
    const { controller, saved, setRating } = setup();
    controller.rate("up");
    controller.setDraft("typed");

    setRating("down");
    controller.sync({ showsToolbar: true });

    expect(controller.getSnapshot().open).toBe(false);
    expect(saved).toEqual([{ rating: "up" }]);
  });

  it("saves the comment when the toolbar hides", () => {
    const { controller, saved } = setup();
    controller.rate("up");
    controller.setDraft("typed");

    controller.sync({ showsToolbar: false });

    expect(controller.getSnapshot().open).toBe(false);
    expect(saved).toEqual([
      { rating: "up" },
      { rating: "up", comment: "typed" },
    ]);
  });
});

describe("ɵFeedbackCommentController popover", () => {
  it("returns focus to the thumb on Escape and asks to stop the event", () => {
    const { controller } = setup();
    controller.rate("up", { target: byId("up") });
    byId("field").focus();

    expect(controller.popoverEscape(byId("popover"))).toBe(true);

    expect(controller.getSnapshot().open).toBe(false);
    expect(document.activeElement).toBe(byId("up"));
  });

  it("lets Escape through when focus is outside the popover", () => {
    const { controller } = setup();
    controller.rate("up", { target: byId("up") });
    byId("after").focus();

    expect(controller.popoverEscape(byId("popover"))).toBe(false);
    expect(document.activeElement).toBe(byId("after"));
  });

  it("moves Tab from the popover's last control to the control after the thumb", () => {
    const { controller, saved } = setup();
    controller.rate("up", { target: byId("up") });
    controller.setDraft("nice");
    byId("send").focus();
    const event = tab();

    controller.popoverKeyDown(event, byId("popover"));

    expect(event.preventDefault).toHaveBeenCalled();
    // The next tab stop after the thumb, outside the popover.
    expect(document.activeElement).toBe(byId("down"));
    expect(controller.getSnapshot().open).toBe(false);
    expect(saved.at(-1)).toEqual({ rating: "up", comment: "nice" });
  });

  it("moves Shift+Tab from the popover's first control back to the thumb", () => {
    const { controller } = setup();
    controller.rate("up", { target: byId("up") });
    byId("field").focus();

    controller.popoverKeyDown(tab(true), byId("popover"));

    expect(document.activeElement).toBe(byId("up"));
    expect(controller.getSnapshot().open).toBe(false);
  });

  it("leaves Tab between the popover's own controls alone", () => {
    const { controller } = setup();
    controller.rate("up", { target: byId("up") });
    byId("field").focus();
    const event = tab();

    controller.popoverKeyDown(event, byId("popover"));

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(controller.getSnapshot().open).toBe(true);
  });

  it("keeps the comment open when focus moves to a thumb of the message", () => {
    vi.useFakeTimers();
    try {
      const { controller } = setup();
      controller.rate("up", { target: byId("up") });

      controller.popoverFocusLeave(byId("down"), byId("popover"), "m1");
      vi.runAllTimers();
      expect(controller.getSnapshot().open).toBe(true);

      controller.popoverFocusLeave(byId("after"), byId("popover"), "m1");
      vi.runAllTimers();
      expect(controller.getSnapshot().open).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ɵisOwnFeedbackThumb", () => {
  it("matches a thumb, or an element inside one, of the same message only", () => {
    document.body.innerHTML = `
      <div data-message-id="m1"><button data-copilotkit-rating="up"><span id="icon"></span></button></div>
      <div data-message-id="m2"><button id="other" data-copilotkit-rating="up"></button></div>
    `;
    expect(ɵisOwnFeedbackThumb(document.getElementById("icon"), "m1")).toBe(
      true,
    );
    expect(ɵisOwnFeedbackThumb(document.getElementById("other"), "m1")).toBe(
      false,
    );
    expect(ɵisOwnFeedbackThumb(null, "m1")).toBe(false);
  });
});
