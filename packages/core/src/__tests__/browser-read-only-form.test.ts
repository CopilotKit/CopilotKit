// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPageMap } from "../autopilot/browser-page-map";
import { BrowserReadOnlyForm } from "../autopilot/browser-read-only-form";

beforeEach(() => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue({
    length: 1,
  } as DOMRectList);
  window.history.replaceState({}, "", "/orders");
  document.body.innerHTML = `<main data-copilot-page><form action="/orders" method="get" data-copilot-readonly-form><label>Search orders<input name="q" type="search"></label><button type="submit">Search</button></form></main>`;
});
afterEach(() => vi.restoreAllMocks());

function setup() {
  const map = new BrowserPageMap();
  const controls = map.read().controls;
  const fieldRef = controls.find((control) => control.kind === "input")!.ref;
  const submitRef = controls.find((control) => control.kind === "button")!.ref;
  const push = vi.fn((path: string) => {
    window.history.pushState({}, "", path);
    document.querySelector("main")!.innerHTML = "Search results";
  });
  const driver = new BrowserReadOnlyForm(map, {
    push,
    mayLeave: () => true,
    allowedPath: (path) => path === "/orders",
  });
  return { driver, fieldRef, submitRef, push };
}

describe("BrowserReadOnlyForm", () => {
  it("drives a declared GET query with discovered controls", async () => {
    const { driver, fieldRef, submitRef, push } = setup();
    const result = await driver.submit({
      fieldRef,
      value: "NS-1001",
      submitRef,
    });
    expect(result.status).toBe("arrived");
    expect(push).toHaveBeenCalledWith("/orders?q=NS-1001");
  });

  it("refuses a form without the read-only declaration or GET method", async () => {
    const { driver, fieldRef, submitRef, push } = setup();
    document
      .querySelector("form")!
      .removeAttribute("data-copilot-readonly-form");
    await expect(
      driver.submit({ fieldRef, value: "test", submitRef }),
    ).rejects.toThrow("not declared read-only");
    document
      .querySelector("form")!
      .setAttribute("data-copilot-readonly-form", "");
    document.querySelector("form")!.setAttribute("method", "post");
    await expect(
      driver.submit({ fieldRef, value: "test", submitRef }),
    ).rejects.toThrow("not declared read-only");
    expect(push).not.toHaveBeenCalled();
  });

  it("refuses stale controls before changing the page", async () => {
    const { driver, fieldRef, submitRef, push } = setup();
    document.querySelector("input")!.remove();
    await expect(
      driver.submit({ fieldRef, value: "test", submitRef }),
    ).rejects.toThrow("Control changed");
    expect(push).not.toHaveBeenCalled();
  });
});
