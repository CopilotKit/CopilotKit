import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installNavigationCapture } from "../navigation";

interface Captured {
  name: string;
  value: Record<string, unknown>;
}

const originalPushState = History.prototype.pushState;
const originalReplaceState = History.prototype.replaceState;
let uninstall: (() => void) | undefined;

beforeEach(() => {
  originalReplaceState.call(history, null, "", "/learning");
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  Reflect.deleteProperty(history, "pushState");
});

function setup() {
  const events: Captured[] = [];
  uninstall = installNavigationCapture({
    emit: (name, value) => events.push({ name, value }),
    routes: ["/learning/deals/:id"],
  });
  return events;
}

describe("installNavigationCapture (history fallback)", () => {
  it("emits push and replace when the full URL changes", () => {
    const events = setup();

    history.pushState(null, "", "/learning/deals/42");
    history.replaceState(null, "", "/learning/events");

    expect(events).toEqual([
      {
        name: "navigation",
        value: {
          from: `${location.origin}/learning`,
          to: `${location.origin}/learning/deals/42`,
          navigationType: "push",
        },
      },
      {
        name: "navigation",
        value: {
          from: `${location.origin}/learning/deals/42`,
          to: `${location.origin}/learning/events`,
          navigationType: "replace",
        },
      },
    ]);
  });

  it("records changes within a route, including query strings and fragments", () => {
    const events = setup();

    history.pushState(null, "", "/learning/deals/1");
    history.pushState(null, "", "/learning/deals/2?tab=notes#top");

    expect(events).toHaveLength(2);
    expect(events[1]?.value.to).toBe(
      `${location.origin}/learning/deals/2?tab=notes#top`,
    );
  });

  it("still fires when a router wrapped the instance method before install", () => {
    const routerPushState = history.pushState;
    history.pushState = function (...args) {
      return routerPushState.apply(this, args);
    };
    const events = setup();

    history.pushState(null, "", "/learning/deals/7");

    expect(events).toEqual([
      {
        name: "navigation",
        value: {
          from: `${location.origin}/learning`,
          to: `${location.origin}/learning/deals/7`,
          navigationType: "push",
        },
      },
    ]);
  });

  it("emits traverse on back navigation", async () => {
    const events = setup();
    history.pushState(null, "", "/learning/deals/3");
    const popped = new Promise((resolve) =>
      window.addEventListener("popstate", resolve, { once: true }),
    );

    history.back();
    await popped;

    expect(events.at(-1)?.value).toEqual({
      from: `${location.origin}/learning/deals/3`,
      to: `${location.origin}/learning`,
      navigationType: "traverse",
    });
  });

  it("restores the original history methods on uninstall", () => {
    setup();
    uninstall?.();
    uninstall = undefined;

    expect(History.prototype.pushState).toBe(originalPushState);
    expect(History.prototype.replaceState).toBe(originalReplaceState);
  });
});
