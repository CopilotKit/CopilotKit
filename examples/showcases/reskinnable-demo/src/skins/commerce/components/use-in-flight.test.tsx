import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useInFlight } from "./use-in-flight";

/**
 * The guard itself, tested apart from the buttons.
 *
 * It has to be, because jsdom does NOT dispatch a click to a `disabled` button: a
 * rendered double-click therefore only ever proves the visible half (that the
 * lever went disabled), never that `run` is a mutex in its own right. These four
 * go at the mechanism directly.
 *
 * They live beside the hook rather than in the page that first used it — the hook
 * is shared by `pages/promotions.tsx` and `pages/returns.tsx`, and a mechanism
 * test filed under one caller is a test the next caller does not know exists.
 *
 * No `@testing-library/jest-dom` in this app, so assertions are plain DOM.
 */

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useInFlight", () => {
  /** A promise the test settles by hand, so "in flight" is a real state. */
  function deferred<T>() {
    let settle: (value: T) => void = () => {};
    const promise = new Promise<T>((resolve) => {
      settle = resolve;
    });
    return { promise, settle };
  }

  it("refuses a second action while the first is still outstanding", async () => {
    const { result } = renderHook(() => useInFlight());
    const first = deferred<boolean>();
    let secondRan = false;

    let firstResult: Promise<boolean> = Promise.resolve(false);
    let secondResult: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      firstResult = result.current.run("finalize", () => first.promise);
      secondResult = result.current.run("finalize", async () => {
        secondRan = true;
        return true;
      });
    });

    // The whole point: the second action never even ran, so the store never saw
    // the repeat that would have come back ALREADY_FINALIZED.
    expect(secondRan).toBe(false);
    await expect(secondResult).resolves.toBe(false);

    await act(async () => first.settle(true));
    await expect(firstResult).resolves.toBe(true);
  });

  it("frees the guard once the first action settles", async () => {
    const { result } = renderHook(() => useInFlight());
    await act(async () => {
      await result.current.run("finalize", async () => true);
    });
    let ran = false;
    await act(async () => {
      await result.current.run("finalize", async () => {
        ran = true;
        return true;
      });
    });
    expect(ran).toBe(true);
  });

  it("frees the guard even when the action THROWS, and resolves false", async () => {
    const { result } = renderHook(() => useInFlight());
    let thrown: boolean | undefined;
    await act(async () => {
      // Must not reject: every call site is a bare `void run(...)`.
      thrown = await result.current.run("file", async () => {
        throw new TypeError("Failed to fetch");
      });
    });
    expect(thrown).toBe(false);

    let ran = false;
    await act(async () => {
      await result.current.run("file", async () => {
        ran = true;
        return true;
      });
    });
    expect(ran).toBe(true);
  });

  it("reports which action is in flight, and nothing once it settles", async () => {
    const { result } = renderHook(() => useInFlight());
    const first = deferred<boolean>();
    expect(result.current.busy).toBeNull();

    let pending: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      pending = result.current.run("wvr-1", () => first.promise);
    });
    expect(result.current.busy).toBe("wvr-1");

    await act(async () => {
      first.settle(true);
      await pending;
    });
    expect(result.current.busy).toBeNull();
  });
});
