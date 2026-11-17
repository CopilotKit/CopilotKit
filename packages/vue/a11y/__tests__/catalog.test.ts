import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/vue";
import { nextTick } from "vue";
import fixtures from "../../../a11y-test-kit/fixtures.json";
import { observeClicks } from "../../../a11y-test-kit/src/index";
import { audit } from "../../../a11y-test-kit/src/report";
import { renderSurface } from "../../src/v2/generative-ui/__tests__/helpers/render-surface";
import { standardUI } from "../../src/v2/generative-ui/standard";

const initialDir = document.documentElement.getAttribute("dir");
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
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
      // Vue Test Utils attaches native emitted-event spies to the surface root.
      // It is a harness boundary, not an actionable catalog component.
      host = view.container.querySelector("[data-generative-ui-root]")!;
      await nextTick();
      if (fixture.activate) {
        const trigger = view.container.querySelector<HTMLElement>(
          fixture.activate,
        )!;
        trigger.focus();
        await fireEvent.click(trigger);
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
      "vue",
      fixture.name,
      clicks!,
      host!,
      fixture.pattern as "tabs" | "dialog" | null,
    );
  });
});
