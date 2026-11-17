import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import fixtures from "../../../a11y-test-kit/fixtures.json";
import { observeClicks } from "../../../a11y-test-kit/src/index";
import { audit } from "../../../a11y-test-kit/src/report";
import { renderSurface } from "../../src/v2/generative-ui/standard/__tests__/render";
import { standardUI } from "../../src/v2/generative-ui/standard";

const initialDir = document.documentElement.getAttribute("dir");
afterEach(() => {
  cleanup();
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
      await waitFor(() =>
        expect(view.container.children.length).toBeGreaterThan(0),
      );
      if (fixture.activate) {
        const trigger = view.container.querySelector<HTMLElement>(
          fixture.activate,
        )!;
        trigger.focus();
        fireEvent.click(trigger);
        await waitFor(() =>
          expect(document.querySelector('[role="dialog"]')).not.toBeNull(),
        );
      }
      if (fixture.name === "failed-field")
        await waitFor(() =>
          expect(
            view.container.querySelector('[aria-invalid="true"]'),
          ).not.toBeNull(),
        );
      expect(view.reportError).not.toHaveBeenCalled();
    } finally {
      clicks = stop();
    }
    await audit(
      "react",
      fixture.name,
      clicks!,
      host!,
      fixture.pattern as "tabs" | "dialog" | null,
    );
  });
});
