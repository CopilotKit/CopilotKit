import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveHostDisplayModes,
  ɵdialogRoleForMode,
  ɵlockBodyScroll,
  ɵshowDialogForMode,
  ɵwatchViewportResize,
} from "../display-mode";

/**
 * jsdom has no top layer and no dialog focusing steps, so `show()` and
 * `showModal()` are stubbed the way browsers behave: they open the dialog and
 * move focus to its first focusable descendant.
 */
function mountDialog() {
  const composer = document.createElement("textarea");
  document.body.appendChild(composer);
  const dialog = document.createElement("dialog");
  const inner = document.createElement("button");
  inner.textContent = "inside";
  dialog.appendChild(inner);
  document.body.appendChild(dialog);
  const open = (modal: boolean) => {
    dialog.setAttribute("open", "");
    dialog.setAttribute("data-test-modal", String(modal));
    inner.focus();
  };
  dialog.show = () => open(false);
  dialog.showModal = () => open(true);
  dialog.close = () => {
    dialog.removeAttribute("open");
    dialog.removeAttribute("data-test-modal");
  };
  return { composer, dialog, inner };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ɵshowDialogForMode", () => {
  it("never opens the dialog inline, so the composer keeps the focus", () => {
    const { composer, dialog } = mountDialog();
    const show = vi.spyOn(dialog, "show");
    const blurred = vi.fn();
    composer.addEventListener("blur", blurred);
    composer.focus();

    ɵshowDialogForMode(dialog, "inline");

    // The adapter renders the closed dialog in flow; opening it would run
    // the dialog focusing steps and blur the composer mid-typing.
    expect(show).not.toHaveBeenCalled();
    expect(dialog.open).toBe(false);
    expect(dialog.getAttribute("data-mcp-app-display-mode")).toBe("inline");
    expect(document.activeElement).toBe(composer);
    expect(blurred).not.toHaveBeenCalled();
  });

  it("does not leave the focus inside a widget that opened inline while nothing was focused", () => {
    const { dialog } = mountDialog();
    expect(document.activeElement).toBe(document.body);

    ɵshowDialogForMode(dialog, "inline");

    expect(document.activeElement).toBe(document.body);
  });

  it("lets fullscreen take the focus, so the adapter can land it on the exit button", () => {
    const { composer, dialog, inner } = mountDialog();
    composer.focus();

    ɵshowDialogForMode(dialog, "fullscreen");

    expect(dialog.getAttribute("data-test-modal")).toBe("true");
    expect(document.activeElement).toBe(inner);
  });

  it("opens the dialog modally for fullscreen and closes it for inline, without reparenting its content", () => {
    const { dialog, inner } = mountDialog();
    ɵshowDialogForMode(dialog, "inline");
    ɵshowDialogForMode(dialog, "fullscreen");
    expect(dialog.getAttribute("data-test-modal")).toBe("true");
    ɵshowDialogForMode(dialog, "inline");
    expect(dialog.open).toBe(false);
    expect(dialog.getAttribute("data-mcp-app-display-mode")).toBe("inline");
    expect(inner.parentElement).toBe(dialog);
  });

  it("only marks the dialog open where the dialog API is missing", () => {
    const dialog = document.createElement("dialog");
    document.body.appendChild(dialog);
    (dialog as { show?: unknown }).show = undefined;
    (dialog as { showModal?: unknown }).showModal = undefined;

    ɵshowDialogForMode(dialog, "fullscreen");

    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.getAttribute("data-mcp-app-display-mode")).toBe("fullscreen");
  });
});

describe("ɵdialogRoleForMode", () => {
  it("exposes an inline widget as a group and keeps the dialog role for fullscreen", () => {
    expect(ɵdialogRoleForMode("inline")).toBe("group");
    expect(ɵdialogRoleForMode("fullscreen")).toBeUndefined();
  });
});

describe("resolveHostDisplayModes", () => {
  it("offers both rendered modes by default", () => {
    expect(resolveHostDisplayModes(undefined)).toEqual([
      "inline",
      "fullscreen",
    ]);
  });

  it("narrows to the configured modes and never drops inline", () => {
    expect(resolveHostDisplayModes(["fullscreen"])).toEqual([
      "inline",
      "fullscreen",
    ]);
    expect(resolveHostDisplayModes(["inline"])).toEqual(["inline"]);
    expect(resolveHostDisplayModes(["pip"])).toEqual(["inline"]);
  });
});

describe("ɵlockBodyScroll", () => {
  it("releases the page only when the last holder lets go", () => {
    document.body.style.overflow = "";
    const releaseFirst = ɵlockBodyScroll();
    const releaseSecond = ɵlockBodyScroll();
    expect(document.body.style.overflow).toBe("hidden");
    releaseFirst();
    expect(document.body.style.overflow).toBe("hidden");
    releaseSecond();
    releaseSecond();
    expect(document.body.style.overflow).toBe("");
  });
});

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve(0)));
const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: height,
    configurable: true,
  });
};

describe("ɵwatchViewportResize", () => {
  it("reports once per frame and only when the viewport actually changed", async () => {
    setViewport(1000, 800);
    const onChange = vi.fn();
    const stop = ɵwatchViewportResize(onChange);

    // A burst of resize events with no size change: nothing to report.
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    await nextFrame();
    expect(onChange).not.toHaveBeenCalled();

    // A burst with a change: one report, carrying the final size.
    setViewport(1200, 900);
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    await nextFrame();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ width: 1200, height: 900 });

    stop();
    setViewport(600, 400);
    window.dispatchEvent(new Event("resize"));
    await nextFrame();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
