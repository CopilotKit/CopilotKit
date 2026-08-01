import { renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResolvedHeaders } from "../use-resolved-headers";
import type { HeaderRecord, HeaderSource } from "../use-resolved-headers";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const syncSource = () => ({ Authorization: "Bearer sync" });

describe("useResolvedHeaders", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps static and synchronous sources ready immediately", () => {
    const staticSource = { Authorization: "Bearer static" };
    let staticRenders = 0;
    const staticResult = renderHook(() => {
      staticRenders += 1;
      return useResolvedHeaders(staticSource);
    });
    expect(staticRenders).toBe(1);
    expect(staticResult.result.current).toEqual({
      headers: { Authorization: "Bearer static" },
      ready: true,
      error: null,
    });

    const syncResult = renderHook(() => useResolvedHeaders(syncSource));
    expect(syncResult.result.current).toEqual({
      headers: { Authorization: "Bearer sync" },
      ready: true,
      error: null,
    });
  });

  it("waits for an initial async source and publishes the settled record", async () => {
    const pending = deferred<HeaderRecord>();
    const source = () => pending.promise;
    const { result } = renderHook(() => useResolvedHeaders(source));

    expect(result.current.ready).toBe(false);
    expect(result.current.headers).toEqual({});

    act(() => pending.resolve({ Authorization: "Bearer initial" }));
    await waitFor(() => {
      expect(result.current).toEqual({
        headers: { Authorization: "Bearer initial" },
        ready: true,
        error: null,
      });
    });
  });

  it("keeps the last good record after a refresh rejection", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = deferred<HeaderRecord>();
    const refresh = deferred<HeaderRecord>();
    let source: HeaderSource = () => first.promise;
    const { result, rerender } = renderHook(
      ({ headerSource }: { headerSource: HeaderSource }) =>
        useResolvedHeaders(headerSource),
      { initialProps: { headerSource: source } },
    );

    act(() => first.resolve({ Authorization: "Bearer good" }));
    await waitFor(() => expect(result.current.ready).toBe(true));

    source = () => refresh.promise;
    rerender({ headerSource: source });
    act(() => refresh.reject(new Error("Bearer secret")));

    await waitFor(() => {
      expect(result.current.headers).toEqual({ Authorization: "Bearer good" });
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect(result.current.ready).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      "[CopilotKit] Failed to resolve request headers",
    );
  });

  it("rejects invalid async records and retries with a valid source", async () => {
    const invalid = deferred<HeaderRecord | undefined>();
    const valid = deferred<HeaderRecord>();
    let source: HeaderSource = () =>
      invalid.promise as PromiseLike<HeaderRecord>;
    const { result, rerender } = renderHook(
      ({ headerSource }: { headerSource: HeaderSource }) =>
        useResolvedHeaders(headerSource),
      { initialProps: { headerSource: source } },
    );

    act(() => invalid.resolve(undefined));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.ready).toBe(false);
    expect(result.current.headers).toEqual({});

    source = () => valid.promise;
    rerender({ headerSource: source });
    act(() => valid.resolve({ Authorization: "Bearer valid" }));
    await waitFor(() => {
      expect(result.current).toEqual({
        headers: { Authorization: "Bearer valid" },
        ready: true,
        error: null,
      });
    });
  });

  it("publishes only the latest overlapping async result", async () => {
    const first = deferred<HeaderRecord>();
    const second = deferred<HeaderRecord>();
    const { result, rerender } = renderHook(
      ({ headerSource }: { headerSource: HeaderSource }) =>
        useResolvedHeaders(headerSource),
      { initialProps: { headerSource: () => first.promise } },
    );

    rerender({ headerSource: () => second.promise });
    act(() => second.resolve({ Authorization: "Bearer latest" }));
    await waitFor(() =>
      expect(result.current.headers).toEqual({
        Authorization: "Bearer latest",
      }),
    );

    act(() => first.resolve({ Authorization: "Bearer stale" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.headers).toEqual({
      Authorization: "Bearer latest",
    });
  });

  it("reevaluates a stable async builder on a parent rerender", async () => {
    const first = deferred<HeaderRecord>();
    const second = deferred<HeaderRecord>();
    const source = vi
      .fn<() => Promise<HeaderRecord>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValue(second.promise);
    const { result, rerender } = renderHook(() => useResolvedHeaders(source));

    rerender();
    expect(source).toHaveBeenCalledTimes(2);
    act(() => second.resolve({ Authorization: "Bearer current" }));
    await waitFor(() =>
      expect(result.current.headers).toEqual({
        Authorization: "Bearer current",
      }),
    );

    act(() => first.resolve({ Authorization: "Bearer stale" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.headers).toEqual({
      Authorization: "Bearer current",
    });
  });

  it("does not publish a pending result after unmount", async () => {
    const pending = deferred<HeaderRecord>();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const source = () => pending.promise;
    const { result, unmount } = renderHook(() => useResolvedHeaders(source));
    unmount();

    act(() => pending.reject(new Error("Bearer late")));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.ready).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
