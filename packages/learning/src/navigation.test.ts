import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeToNavigation } from "./navigation";

const cleanup: (() => void)[] = [];
const restoreHistory: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop());
  restoreHistory
    .splice(0)
    .toReversed()
    .forEach((restore) => restore());
  vi.restoreAllMocks();
});

function preserveHistory() {
  for (const name of ["pushState", "replaceState"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(window.history, name);
    restoreHistory.push(() => {
      if (descriptor) Object.defineProperty(window.history, name, descriptor);
      else Reflect.deleteProperty(window.history, name);
    });
  }
}

describe("navigation observation lifecycle", () => {
  it("shares wrappers, preserves native arguments and restores after the final subscription", () => {
    const original = window.history.pushState;
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeToNavigation(window, first);
    const wrapped = window.history.pushState;
    const stopSecond = subscribeToNavigation(window, second);
    cleanup.push(stopFirst, stopSecond);
    const state = { page: "review" };
    window.history.pushState(state, "", "#navigation-test");
    expect(window.history.state).toEqual(state);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    stopFirst();
    expect(window.history.pushState).toBe(wrapped);
    window.dispatchEvent(new Event("popstate"));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
    expect(window.history.pushState).toBe(original);
    window.dispatchEvent(new Event("hashchange"));
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("completes cleanup when a host hardens an installed history method", () => {
    preserveHistory();
    const originalReplace = window.history.replaceState;
    const listener = vi.fn();
    const stop = subscribeToNavigation(window, listener);
    cleanup.push(stop);
    const retained = window.history.pushState;
    Object.defineProperty(window.history, "pushState", {
      value: retained,
      writable: false,
      configurable: true,
    });
    expect(stop).not.toThrow();
    expect(stop).not.toThrow();
    expect(window.history.replaceState).toBe(originalReplace);
    retained.call(window.history, {}, "", "#after-cleanup");
    window.dispatchEvent(new Event("popstate"));
    window.dispatchEvent(new Event("hashchange"));
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not overwrite later wrappers or disturb a new subscription when stopped twice", () => {
    preserveHistory();
    const original = window.history.pushState;
    const first = vi.fn();
    const stop = subscribeToNavigation(window, first);
    const captured = window.history.pushState;
    const later: History["pushState"] = function (this: History, ...args) {
      return Reflect.apply(captured, this, args);
    };
    window.history.pushState = later;
    cleanup.push(stop);
    stop();
    expect(window.history.pushState).toBe(later);
    const second = vi.fn();
    const stopSecond = subscribeToNavigation(window, second);
    cleanup.push(stopSecond);
    stop();
    window.history.pushState({}, "", "#new-subscription");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    stopSecond();
    expect(window.history.pushState).toBe(later);
    window.history.pushState = original;
  });
});
