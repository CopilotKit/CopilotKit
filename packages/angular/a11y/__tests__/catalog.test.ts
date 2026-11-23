import { afterEach, describe, expect, it } from "vitest";
import { TestBed } from "@angular/core/testing";
import fixtures from "../../../a11y-test-kit/fixtures.json";
import { observeClicks } from "../../../a11y-test-kit/src/index";
import { audit } from "../../../a11y-test-kit/src/report";
import { renderSurface } from "../../src/generative-ui/lib/__tests__/render";
import { standardUI } from "../../src/generative-ui/lib/standard";

const initialDir = document.documentElement.getAttribute("dir");
afterEach(() => {
  TestBed.resetTestingModule();
  if (initialDir === null) document.documentElement.removeAttribute("dir");
  else document.documentElement.setAttribute("dir", initialDir);
});
describe("A2UI accessibility baseline", () => {
  it.each(fixtures)("$name", async (fixture) => {
    document.documentElement.dir =
      "dir" in fixture ? String(fixture.dir) : "ltr";
    const stop = observeClicks();
    let clicks: ReadonlySet<Element>;
    let host: Element;
    try {
      const view = renderSurface(
        standardUI,
        fixture.components as Parameters<typeof renderSurface>[1],
        fixture.data,
      );
      host = view.container;
      view.detectChanges();
      await view.fixture.whenStable();
      if (fixture.activate) {
        view.act(() => {
          const trigger = view.container.querySelector<HTMLElement>(
            fixture.activate!,
          )!;
          trigger.focus();
          trigger.click();
        });
        await view.fixture.whenStable();
        view.detectChanges();
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      }
      if (fixture.name === "failed-field")
        expect(
          view.container.querySelector('[aria-invalid="true"]'),
        ).not.toBeNull();
      expect(view.reportError).not.toHaveBeenCalled();
    } finally {
      clicks = stop();
    }
    await audit(
      "angular",
      fixture.name,
      clicks!,
      host!,
      fixture.pattern as "tabs" | "dialog" | null,
    );
  });
});
