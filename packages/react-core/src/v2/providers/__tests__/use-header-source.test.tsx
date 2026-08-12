import { renderHook, act } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { useHeaderSource } from "../use-header-source";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useHeaderSource", () => {
  it("invokes a stable async source once across unrelated rerenders", async () => {
    const pending = deferred<Record<string, string>>();
    let calls = 0;
    const source = () => {
      calls += 1;
      return pending.promise;
    };
    const { result, rerender } = renderHook(() => useHeaderSource(source));
    for (let i = 0; i < 20; i += 1) rerender();
    expect(calls).toBe(1);
    expect(result.current.headers).toBeNull();
    await act(async () => pending.resolve({ Authorization: "Bearer one" }));
    expect(result.current.headers).toEqual({ Authorization: "Bearer one" });
  });

  it("retains the last good record when a refresh rejects", async () => {
    const first: Promise<Record<string, string>> = Promise.resolve({
      Authorization: "Bearer one",
    });
    let rejectRefresh!: (error: Error) => void;
    const refresh = new Promise<Record<string, string>>((_, reject) => {
      rejectRefresh = reject;
    });
    let source = () => first;
    const { result, rerender } = renderHook(() => useHeaderSource(source));
    await act(async () => first);
    source = () => refresh;
    rerender();
    await act(async () => rejectRefresh(new Error("expired")));
    expect(result.current.headers).toEqual({ Authorization: "Bearer one" });
    expect(result.current.error?.message).toBe("expired");
  });

  it("refreshes exactly once when the source identity changes", async () => {
    const first = deferred<Record<string, string>>();
    const second = deferred<Record<string, string>>();
    const firstSource = vi.fn(() => first.promise);
    let source: () => Promise<Record<string, string>> = firstSource;
    const { result, rerender } = renderHook(() => useHeaderSource(source));

    expect(firstSource).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve({ Authorization: "Bearer one" }));
    const replacement = () => second.promise;
    source = replacement;
    rerender();
    rerender();
    expect(firstSource).toHaveBeenCalledTimes(1);
    expect(result.current.headers).toEqual({ Authorization: "Bearer one" });
    await act(async () => second.resolve({ Authorization: "Bearer two" }));
    expect(result.current.headers).toEqual({ Authorization: "Bearer two" });
  });

  it("ignores a stale result after a source replacement", async () => {
    const first = deferred<Record<string, string>>();
    const second = deferred<Record<string, string>>();
    let source = () => first.promise;
    const { result, rerender } = renderHook(() => useHeaderSource(source));
    await act(async () => {
      source = () => second.promise;
      rerender();
      second.resolve({ Authorization: "Bearer current" });
      first.resolve({ Authorization: "Bearer stale" });
    });
    expect(result.current.headers).toEqual({ Authorization: "Bearer current" });
  });

  it("does not publish a pending result after unmount", async () => {
    const pending = deferred<Record<string, string>>();
    const { result, unmount } = renderHook(() =>
      useHeaderSource(() => pending.promise),
    );
    unmount();
    await act(async () => pending.resolve({ Authorization: "Bearer late" }));
    expect(result.current.headers).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("normalizes nullish values before publishing a settled record", async () => {
    const { result } = renderHook(() =>
      useHeaderSource((() =>
        Promise.resolve({
          Authorization: undefined,
        })) as unknown as () => Promise<Record<string, string>>),
    );
    await act(async () => undefined);
    expect(result.current.headers).toEqual({});
  });

  it("keeps synchronous sources on the synchronous path", () => {
    let calls = 0;
    const source = () => {
      calls += 1;
      return { Authorization: `Bearer ${calls}` };
    };
    const { result, rerender } = renderHook(() => useHeaderSource(source));
    rerender();
    expect(calls).toBe(2);
    expect(result.current.headers).toEqual({ Authorization: "Bearer 2" });
    expect(result.current.error).toBeNull();
  });

  it("does not duplicate a stable async evaluation in StrictMode", () => {
    const pending = deferred<Record<string, string>>();
    const source = vi.fn(() => pending.promise);
    renderHook(() => useHeaderSource(source), {
      wrapper: ({ children }) => (
        <React.StrictMode>{children}</React.StrictMode>
      ),
    });
    expect(source).toHaveBeenCalledTimes(1);
  });
});
