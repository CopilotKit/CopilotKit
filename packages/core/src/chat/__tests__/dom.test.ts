// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ɵbindDialogFocus,
  ɵbindPopupDismiss,
  ɵcanPreviewDocument,
  ɵcreateDockedSidebar,
  ɵcreateObjectUrlFromSource,
  ɵdecodeTextSource,
  ɵdimensionToCss,
  ɵdockedSidebarRegistryFor,
  ɵisScrolledToBottom,
  ɵmorphViewTransition,
  ɵPOPUP_ANIMATION_MS,
} from "../dom";

function body() {
  return document.body.style;
}

function setupPopup(clickOutsideToClose: boolean) {
  const container = document.createElement("div");
  container.tabIndex = -1;
  const inside = document.createElement("button");
  container.append(inside);
  const toggle = document.createElement("button");
  toggle.dataset.slot = "chat-toggle-button";
  const toggleIcon = document.createElement("span");
  toggle.append(toggleIcon);
  const popover = document.createElement("div");
  popover.setAttribute("data-copilotkit-popover", "");
  const popoverText = document.createElement("span");
  popover.append(popoverText);
  const outside = document.createElement("div");
  document.body.append(container, toggle, popover, outside);
  const onDismiss = vi.fn();
  const unbind = ɵbindPopupDismiss({
    getContainer: () => container,
    onDismiss,
    clickOutsideToClose,
  });
  return {
    container,
    inside,
    toggleIcon,
    popoverText,
    outside,
    onDismiss,
    unbind,
  };
}

function pointerDown(target: Element) {
  target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
}

function setupDialog() {
  const opener = document.createElement("button");
  const root = document.createElement("div");
  const close = document.createElement("button");
  const link = document.createElement("a");
  link.href = "#";
  root.append(close, link);
  document.body.append(opener, root);
  opener.focus();
  return { opener, root, close, link };
}

function tab(root: HTMLElement, shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    cancelable: true,
  });
  root.dispatchEvent(event);
  return event;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
});

describe("ɵdimensionToCss", () => {
  it.each([
    { value: 420, expected: "420px" },
    { value: " 30rem ", expected: "30rem" },
    { value: "   ", expected: "480px" },
    { value: Number.NaN, expected: "480px" },
    { value: undefined, expected: "480px" },
  ])("turns $value into $expected", ({ value, expected }) => {
    expect(ɵdimensionToCss(value, 480)).toBe(expected);
  });
});

describe("ɵdockedSidebarRegistryFor", () => {
  it("restores the margins the page had before", () => {
    body().marginInlineStart = "10px";
    body().marginInlineEnd = "20px";
    const registry = ɵdockedSidebarRegistryFor(document);
    const owner = Symbol("a");

    registry.acquire(owner);
    registry.update(owner, { position: "right", width: "480px" });
    expect([body().marginInlineStart, body().marginInlineEnd]).toEqual([
      "10px",
      "480px",
    ]);

    registry.release(owner);
    expect([body().marginInlineStart, body().marginInlineEnd]).toEqual([
      "10px",
      "20px",
    ]);
  });

  it("gives the margins to one sidebar at a time and warns about the second", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = ɵdockedSidebarRegistryFor(document);
    const first = Symbol("first");
    const second = Symbol("second");

    expect(registry.acquire(first)).toBe(true);
    expect(registry.acquire(second)).toBe(false);
    expect(registry.acquire(second)).toBe(false);
    registry.update(second, { position: "left", width: "300px" });

    expect(body().marginInlineStart).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[CopilotKit] Only one docked CopilotSidebar may be open per document.",
    );
    registry.release(first);
  });

  it("is one registry per document", () => {
    expect(ɵdockedSidebarRegistryFor(document)).toBe(
      ɵdockedSidebarRegistryFor(document),
    );
  });

  it("animates a release, then restores the page's own transition", () => {
    vi.useFakeTimers();
    body().transition = "opacity 1s";
    const registry = ɵdockedSidebarRegistryFor(document);
    const owner = Symbol("a");
    registry.acquire(owner);
    registry.update(owner, { position: "left", width: "300px" });

    registry.release(owner, { transitionMs: 260 });
    expect(body().transition).toBe(
      "margin-inline-start 260ms ease, margin-inline-end 260ms ease",
    );

    vi.advanceTimersByTime(260);
    expect(body().transition).toBe("opacity 1s");
  });
});

describe("ɵcreateDockedSidebar", () => {
  let isMobile = false;
  let changeListener: (() => void) | undefined;

  beforeEach(() => {
    isMobile = false;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return query === "(max-width: 767px)" && isMobile;
      },
      addEventListener: (_type: string, listener: () => void) => {
        changeListener = listener;
      },
      removeEventListener: () => {
        changeListener = undefined;
      },
    }));
  });

  it("docks on desktop and animates every change after the first", () => {
    const dock = ɵcreateDockedSidebar(document, { transitionMs: 260 });

    dock.set({ open: true, position: "right", width: "480px" });
    expect(document.body.style.marginInlineEnd).toBe("480px");
    expect(document.body.style.transition).toBe("");

    dock.set({ open: false, position: "right", width: "480px" });
    expect(document.body.style.marginInlineEnd).toBe("");
    expect(document.body.style.transition).toContain("260ms");
    dock.dispose();
  });

  it("gives the margin back when the viewport becomes a phone", () => {
    const dock = ɵcreateDockedSidebar(document, { transitionMs: 260 });
    dock.set({ open: true, position: "left", width: "300px" });

    isMobile = true;
    changeListener?.();

    expect(document.body.style.marginInlineStart).toBe("");
    dock.dispose();
  });

  it("does not dock on a phone", () => {
    isMobile = true;
    const dock = ɵcreateDockedSidebar(document, { transitionMs: 260 });
    dock.set({ open: true, position: "left", width: "300px" });
    expect(document.body.style.marginInlineStart).toBe("");
    dock.dispose();
  });

  it("restores the page's margins on dispose", () => {
    document.body.style.marginInlineEnd = "8px";
    const dock = ɵcreateDockedSidebar(document, { transitionMs: 260 });
    dock.set({ open: true, position: "right", width: "480px" });

    dock.dispose();

    expect(document.body.style.marginInlineEnd).toBe("8px");
  });
});

describe("ɵbindPopupDismiss", () => {
  it("closes on Escape", () => {
    const { onDismiss } = setupPopup(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("closes on a pointer down outside, but not inside, on the toggle, or in a popover", () => {
    const { inside, toggleIcon, popoverText, outside, onDismiss } =
      setupPopup(true);

    pointerDown(inside);
    pointerDown(toggleIcon);
    pointerDown(popoverText);
    expect(onDismiss).not.toHaveBeenCalled();

    pointerDown(outside);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores a pointer down outside unless asked", () => {
    const { outside, onDismiss } = setupPopup(false);
    pointerDown(outside);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("focuses the panel after the open animation, unless focus is inside", () => {
    vi.useFakeTimers();
    const { container } = setupPopup(false);

    vi.advanceTimersByTime(ɵPOPUP_ANIMATION_MS - 1);
    expect(document.activeElement).toBe(document.body);
    vi.advanceTimersByTime(1);
    expect(document.activeElement).toBe(container);
  });

  it("keeps focus that is already inside the panel", () => {
    vi.useFakeTimers();
    const { inside } = setupPopup(false);
    inside.focus();
    vi.advanceTimersByTime(ɵPOPUP_ANIMATION_MS);
    expect(document.activeElement).toBe(inside);
  });

  it("does nothing after unbinding", () => {
    const { outside, onDismiss, unbind } = setupPopup(true);
    unbind();
    pointerDown(outside);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("ɵmorphViewTransition", () => {
  /** Records the thumbnail's name before and after the update, as the API snapshots. */
  function stubViewTransitions() {
    const names: string[] = [];
    let finished = Promise.resolve();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => Promise<void>) => {
        names.push(thumb.style.viewTransitionName);
        finished = update().then(() => {
          names.push(thumb.style.viewTransitionName);
        });
        return { finished };
      },
    });
    return { names, finished: () => finished };
  }

  let thumb: HTMLElement;
  beforeEach(() => {
    thumb = document.createElement("img");
  });
  afterEach(() => {
    Reflect.deleteProperty(document, "startViewTransition");
  });

  it("applies the change without a transition when the API is missing", () => {
    const apply = vi.fn();
    ɵmorphViewTransition(thumb, "lightbox", apply, "open");
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("moves the name off the thumbnail on open", async () => {
    const { names, finished } = stubViewTransitions();
    const apply = vi.fn();

    ɵmorphViewTransition(thumb, "lightbox", apply, "open");
    await finished();

    expect(apply).toHaveBeenCalledTimes(1);

    // Before the change the thumbnail has the name; after, the preview has it.
    expect(names).toEqual(["lightbox", ""]);
  });

  it("puts the name back on the thumbnail on close, then clears it", async () => {
    const { names, finished } = stubViewTransitions();

    ɵmorphViewTransition(thumb, "lightbox", () => {}, "close");
    await finished();

    expect(names).toEqual(["", "lightbox"]);
    expect(thumb.style.viewTransitionName).toBe("");
  });
});

describe("ɵbindDialogFocus", () => {
  it("moves focus to the first focusable element", () => {
    const { root, close } = setupDialog();
    ɵbindDialogFocus(root);
    expect(document.activeElement).toBe(close);
  });

  it("wraps Tab and Shift+Tab inside the dialog", () => {
    const { root, close, link } = setupDialog();
    ɵbindDialogFocus(root);

    link.focus();
    expect(tab(root).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);

    expect(tab(root, true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(link);
  });

  it("lets Tab move between elements inside the dialog", () => {
    const { root } = setupDialog();
    ɵbindDialogFocus(root);
    expect(tab(root).defaultPrevented).toBe(false);
  });

  it("returns focus to the opener", () => {
    const { root, opener } = setupDialog();
    const release = ɵbindDialogFocus(root);
    release();
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus to returnFocusTo when given", () => {
    const { root } = setupDialog();
    const target = document.createElement("input");
    document.body.append(target);
    ɵbindDialogFocus(root, { returnFocusTo: target })();
    expect(document.activeElement).toBe(target);
  });
});

describe("document preview", () => {
  it.each([
    { mimeType: "application/pdf", expected: "pdf" },
    { mimeType: "text/plain", expected: "text" },
    { mimeType: "text/markdown", expected: "text" },
    { mimeType: "application/zip", expected: null },
    { mimeType: undefined, expected: null },
  ])("previews $mimeType as $expected", ({ mimeType, expected }) => {
    expect(ɵcanPreviewDocument(mimeType)).toBe(expected);
  });

  it("returns a URL source as it is", () => {
    const result = ɵcreateObjectUrlFromSource({
      type: "url",
      value: "https://example.test/a.pdf",
      mimeType: "application/pdf",
    });
    expect(result?.url).toBe("https://example.test/a.pdf");
  });

  it("turns base64 data into a blob URL with the data's type", async () => {
    let created: Blob | undefined;
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        created = blob;
        return "blob:preview";
      },
      revokeObjectURL: vi.fn(),
    });

    const result = ɵcreateObjectUrlFromSource({
      type: "data",
      value: btoa("hello"),
      mimeType: "text/plain",
    });
    result?.revoke();

    expect(result?.url).toBe("blob:preview");
    expect(created?.type).toBe("text/plain");
    expect(await created?.text()).toBe("hello");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("returns null for data that is not base64", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      ɵcreateObjectUrlFromSource({
        type: "data",
        value: "not base64!",
        mimeType: "application/pdf",
      }),
    ).toBeNull();
  });

  it("decodes base64 text as UTF-8", () => {
    // "héllo ✓" in UTF-8, base64-encoded.
    expect(
      ɵdecodeTextSource({
        type: "data",
        value: "aMOpbGxvIOKckw==",
        mimeType: "text/plain",
      }),
    ).toBe("héllo ✓");
  });

  it("shows text that is not base64 as it is", () => {
    expect(
      ɵdecodeTextSource({
        type: "data",
        value: "plain!",
        mimeType: "text/plain",
      }),
    ).toBe("plain!");
  });

  it("has no inline text for a URL source", () => {
    expect(
      ɵdecodeTextSource({
        type: "url",
        value: "https://example.test/a.txt",
        mimeType: "text/plain",
      }),
    ).toBeNull();
  });
});

describe("ɵisScrolledToBottom", () => {
  it.each([
    { scrollTop: 488, expected: true },
    { scrollTop: 487, expected: false },
  ])(
    "is $expected 12px or less from the end ($scrollTop)",
    ({ scrollTop, expected }) => {
      // 1000 - 488 - 500 = 12px from the end.
      expect(
        ɵisScrolledToBottom({
          scrollHeight: 1000,
          clientHeight: 500,
          scrollTop,
        }),
      ).toBe(expected);
    },
  );

  it("uses a custom threshold", () => {
    expect(
      ɵisScrolledToBottom(
        { scrollHeight: 1000, clientHeight: 500, scrollTop: 480 },
        20,
      ),
    ).toBe(true);
  });
});
