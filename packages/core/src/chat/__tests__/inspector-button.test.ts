// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ɵHOVER_MENU_CLOSE_DELAY_MS,
  ɵHoverMenuController,
  ɵinspectorKiteFill,
  ɵinspectorKiteIcon,
  ɵinspectorShortcuts,
} from "../inspector-button";

afterEach(() => {
  ɵinspectorShortcuts.reset();
  vi.useRealTimers();
});

describe("ɵinspectorShortcuts", () => {
  it("hides once for every listener until reset", () => {
    const listener = vi.fn();
    const unsubscribe = ɵinspectorShortcuts.subscribe(listener);

    ɵinspectorShortcuts.hide();
    ɵinspectorShortcuts.hide();

    expect(ɵinspectorShortcuts.hidden).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    ɵinspectorShortcuts.reset();
    expect(ɵinspectorShortcuts.hidden).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("ɵinspectorKiteIcon", () => {
  it("fills each gradient path with a gradient it defines", () => {
    const ids = new Set(ɵinspectorKiteIcon.gradients.map(({ id }) => id));
    const fills = ɵinspectorKiteIcon.paths
      .map((path) => ɵinspectorKiteFill("kite-1", path))
      .filter((fill) => fill !== undefined);

    expect(fills).toEqual([
      "url(#kite-1-paint0_linear)",
      "url(#kite-1-paint1_linear)",
      "url(#kite-1-paint2_linear)",
      "url(#kite-1-paint3_linear)",
    ]);
    expect([...ids]).toEqual([
      "paint0_linear",
      "paint1_linear",
      "paint2_linear",
      "paint3_linear",
    ]);
  });

  it("gives stroke-only paths no fill", () => {
    expect(
      ɵinspectorKiteFill("kite-1", {
        d: "M0 0",
        stroke: "#513C9F",
        strokeWidth: "1",
      }),
    ).toBeUndefined();
  });
});

/** A menu trigger button, inside a `.dark` wrapper when `dark`. */
function trigger(dark = false) {
  const wrapper = document.createElement("div");
  if (dark) wrapper.className = "dark";
  const button = document.createElement("button");
  wrapper.append(button);
  return button;
}

describe("ɵHoverMenuController", () => {
  it("opens on a mouse hover and reads the dark theme", () => {
    const menu = new ɵHoverMenuController();

    menu.pointerEnter({ pointerType: "mouse", trigger: trigger(true) });

    expect(menu.getSnapshot()).toEqual({ open: true, dark: true });
    expect(menu.openedByHover).toBe(true);
  });

  it("does not open for touch or while disabled", () => {
    const menu = new ɵHoverMenuController();

    menu.pointerEnter({ pointerType: "touch", trigger: trigger() });
    menu.pointerEnter({
      pointerType: "mouse",
      disabled: true,
      trigger: trigger(),
    });

    expect(menu.getSnapshot().open).toBe(false);
  });

  it("closes after the delay once the pointer leaves", () => {
    vi.useFakeTimers();
    const menu = new ɵHoverMenuController();
    menu.pointerEnter({ pointerType: "mouse", trigger: trigger() });

    menu.scheduleClose();
    vi.advanceTimersByTime(ɵHOVER_MENU_CLOSE_DELAY_MS - 1);
    expect(menu.getSnapshot().open).toBe(true);
    vi.advanceTimersByTime(1);

    expect(menu.getSnapshot().open).toBe(false);
  });

  it("stays open when the pointer comes back in time", () => {
    vi.useFakeTimers();
    const menu = new ɵHoverMenuController();
    menu.pointerEnter({ pointerType: "mouse", trigger: trigger() });

    menu.scheduleClose();
    menu.cancelClose();
    vi.advanceTimersByTime(ɵHOVER_MENU_CLOSE_DELAY_MS);

    expect(menu.getSnapshot().open).toBe(true);
  });

  it("stays open on leave once the keyboard used it", () => {
    vi.useFakeTimers();
    const menu = new ɵHoverMenuController();
    menu.pointerEnter({ pointerType: "mouse", trigger: trigger() });

    menu.keyboardUsed();
    menu.scheduleClose();
    vi.advanceTimersByTime(ɵHOVER_MENU_CLOSE_DELAY_MS);

    expect(menu.getSnapshot().open).toBe(true);
  });

  it("keeps the snapshot and skips listeners when nothing changes", () => {
    const menu = new ɵHoverMenuController();
    const listener = vi.fn();
    menu.subscribe(listener);
    const before = menu.getSnapshot();

    menu.setOpen(false);

    expect(menu.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("stops a pending close on dispose", () => {
    vi.useFakeTimers();
    const menu = new ɵHoverMenuController();
    menu.pointerEnter({ pointerType: "mouse", trigger: trigger() });
    menu.scheduleClose();

    menu.dispose();
    vi.advanceTimersByTime(ɵHOVER_MENU_CLOSE_DELAY_MS);

    expect(menu.getSnapshot().open).toBe(true);
  });
});
