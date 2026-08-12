import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
