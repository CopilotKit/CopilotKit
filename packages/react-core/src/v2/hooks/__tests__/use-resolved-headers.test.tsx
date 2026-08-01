import { renderHook, waitFor, act } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useHeaderReadiness,
  useResolvedHeaders,
} from "../use-resolved-headers";
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

  it("refreshes a stable async builder after its first result settles", async () => {
    const first = deferred<HeaderRecord>();
    const refresh = deferred<HeaderRecord>();
    const source = vi
      .fn<() => Promise<HeaderRecord>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(refresh.promise);
    const { result, rerender } = renderHook(() => useResolvedHeaders(source));

    act(() => first.resolve({ Authorization: "Bearer first" }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    rerender();
    await waitFor(() => expect(source).toHaveBeenCalledTimes(2));
    expect(result.current.headers).toEqual({
      Authorization: "Bearer first",
    });

    act(() => refresh.resolve({ Authorization: "Bearer refreshed" }));
    await waitFor(() =>
      expect(result.current.headers).toEqual({
        Authorization: "Bearer refreshed",
      }),
    );
  });

  it("retries a stable async builder after its first result rejects", async () => {
    const first = deferred<HeaderRecord>();
    const retry = deferred<HeaderRecord>();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const source = vi
      .fn<() => Promise<HeaderRecord>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise);
    const { result, rerender } = renderHook(() => useResolvedHeaders(source));

    act(() => first.reject(new Error("temporary token failure")));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    rerender();
    await waitFor(() => expect(source).toHaveBeenCalledTimes(2));

    act(() => retry.resolve({ Authorization: "Bearer recovered" }));
    await waitFor(() => {
      expect(result.current).toEqual({
        headers: { Authorization: "Bearer recovered" },
        ready: true,
        error: null,
      });
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[CopilotKit] Failed to resolve request headers",
    );
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

  it("does not reevaluate a stable async builder on a parent rerender", async () => {
    const pending = deferred<HeaderRecord>();
    const source = vi
      .fn<() => Promise<HeaderRecord>>()
      .mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(() => useResolvedHeaders(source));

    rerender();
    expect(source).toHaveBeenCalledTimes(1);
    act(() => pending.resolve({ Authorization: "Bearer current" }));
    await waitFor(() =>
      expect(result.current.headers).toEqual({
        Authorization: "Bearer current",
      }),
    );
  });

  it("retries a stable builder after a transient synchronous evaluation error", async () => {
    let attempts = 0;
    const source = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("token service unavailable");
      return { Authorization: "Bearer recovered" };
    });
    const { result, rerender } = renderHook(() => useResolvedHeaders(source));

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(result.current.ready).toBe(false);

    rerender();

    await waitFor(() => {
      expect(result.current).toEqual({
        headers: { Authorization: "Bearer recovered" },
        ready: true,
        error: null,
      });
    });
    expect(source).toHaveBeenCalledTimes(3);
  });

  it("reevaluates a stable synchronous builder on each render", () => {
    let token = "first";
    const source = vi.fn(() => ({ Authorization: `Bearer ${token}` }));
    const { result, rerender } = renderHook(() => useResolvedHeaders(source));

    expect(result.current.headers).toEqual({ Authorization: "Bearer first" });

    token = "second";
    rerender();

    expect(result.current.headers).toEqual({
      Authorization: "Bearer second",
    });
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("settles pending readiness waiters when unmounted", async () => {
    const { result, unmount } = renderHook(() =>
      useHeaderReadiness(false, null),
    );
    const pending = result.current();

    expect(pending).toBeInstanceOf(Promise);
    unmount();
    await expect(pending).rejects.toThrow("Header readiness was canceled");
  });

  it("keeps readiness waiters pending through StrictMode effect replay", async () => {
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) => useHeaderReadiness(ready, null),
      {
        initialProps: { ready: false },
        wrapper: StrictMode,
      },
    );
    const pending = result.current();

    expect(pending).toBeInstanceOf(Promise);

    rerender({ ready: true });

    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects waiters created after unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useHeaderReadiness(false, null),
    );

    unmount();

    await expect(result.current()).rejects.toThrow(
      "Header readiness was canceled",
    );
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
