import { afterEach, describe, expect, it, vi } from "vitest";
import { expectPattern } from "../../../a11y-test-kit/src/pattern";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
describe("pattern checker jsdom controls", () => {
  it("accepts named keyboard-operable tabs and detects a deliberately broken name", async () => {
    const warning = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    document.body.innerHTML =
      '<div role="tablist" aria-label="Sections"><button role="tab" id="a" aria-controls="pa" aria-selected="true">One</button><button role="tab" id="b" aria-controls="pb" aria-selected="false" tabindex="-1">Two</button></div><div id="pa" role="tabpanel" aria-labelledby="a">First</div><div id="pb" role="tabpanel" aria-labelledby="b" hidden>Second</div>';
    const tabs = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ];
    tabs.forEach((tab, i) =>
      tab.addEventListener("keydown", (e) => {
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? 1
              : e.key === "ArrowRight" || e.key === "ArrowLeft"
                ? 1 - i
                : i;
        if (next === i) return;
        e.preventDefault();
        tabs.forEach((t, j) => {
          t.tabIndex = j === next ? 0 : -1;
          t.setAttribute("aria-selected", String(j === next));
          document.getElementById(j === 0 ? "pa" : "pb")!.hidden = j !== next;
        });
        tabs[next].focus();
      }),
    );
    expect(await expectPattern(document.body, "tabs")).toEqual([]);
    document.querySelector('[role="tablist"]')!.removeAttribute("aria-label");
    expect(
      (await expectPattern(document.body, "tabs")).some((x) =>
        x.detail.includes("accessible name"),
      ),
    ).toBe(true);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("[a11y warning] pattern/tabs"),
    );
  });
  it("accepts a named trapping dialog and detects missing initial focus", async () => {
    const warning = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    document.body.innerHTML =
      '<button id="trigger" aria-controls="popup">Open</button><div id="popup" role="dialog" aria-label="Confirm" aria-modal="true"><button>Close</button></div>';
    const popup = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const button = popup.querySelector<HTMLButtonElement>("button")!;
    popup.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        button.focus();
      }
      if (e.key === "Escape") {
        popup.hidden = true;
        document.getElementById("trigger")!.focus();
      }
    });
    document.getElementById("trigger")!.addEventListener("click", () => {
      popup.hidden = false;
      button.focus();
    });
    button.focus();
    expect(await expectPattern(document.body, "dialog")).toEqual([]);
    document.body.innerHTML =
      '<div role="dialog" aria-label="Broken" aria-modal="true"><button>Close</button></div>';
    expect(
      (await expectPattern(document.body, "dialog")).some((x) =>
        x.detail.includes("opening a dialog moves focus"),
      ),
    ).toBe(true);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("[a11y warning] pattern/dialog"),
    );
  });
});
