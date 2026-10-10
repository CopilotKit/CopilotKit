import { afterEach, describe, expect, it } from "vitest";
import {
  resolveHostDisplayModes,
  ɵlockBodyScroll,
  ɵshowDialogForMode,
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
  it("gives the focus back to the composer when a widget opens inline", () => {
    const { composer, dialog } = mountDialog();
    composer.focus();

    ɵshowDialogForMode(dialog, "inline");

    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("data-mcp-app-display-mode")).toBe("inline");
    expect(document.activeElement).toBe(composer);
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

  it("reopens the dialog in the other mode without reparenting its content", () => {
    const { dialog, inner } = mountDialog();
    ɵshowDialogForMode(dialog, "inline");
    ɵshowDialogForMode(dialog, "fullscreen");
    expect(dialog.getAttribute("data-test-modal")).toBe("true");
    ɵshowDialogForMode(dialog, "inline");
    expect(dialog.getAttribute("data-test-modal")).toBe("false");
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
