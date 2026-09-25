// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPageMap } from "../autopilot/browser-page-map";

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  document.title = "Orders";
  window.history.replaceState({}, "", "/orders/current");
  document.body.innerHTML = `
    <main data-copilot-page>
      <form aria-label="Edit order" data-autopilot-record-id="order-1" data-autopilot-record-version="1">
        <button type="button" data-copilot-action="cancel">Cancel order</button>
      </form>
    </main>
  `;
});

afterEach(() => vi.restoreAllMocks());

describe("BrowserPageMap control references", () => {
  it("rejects a removed control rather than acting on a missing target", () => {
    const map = new BrowserPageMap();
    const ref = map
      .read()
      .controls.find((control) => control.kind === "button")?.ref;
    expect(ref).toBeTruthy();
    document.querySelector("button")?.remove();
    expect(() => map.resolve(ref!)).toThrow(
      "Control changed or is no longer available",
    );
  });

  it("rejects a reference when the same element is reused for another record", () => {
    const map = new BrowserPageMap();
    const first = map
      .read()
      .controls.find((control) => control.kind === "button")?.ref;
    expect(first).toBeTruthy();
    document
      .querySelector("form")
      ?.setAttribute("data-autopilot-record-id", "order-2");
    expect(() => map.resolve(first!)).toThrow(
      "Control changed or is no longer available",
    );
    const second = map
      .read()
      .controls.find((control) => control.kind === "button")?.ref;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(map.resolve(second!)).toBe(document.querySelector("button"));
  });
});
