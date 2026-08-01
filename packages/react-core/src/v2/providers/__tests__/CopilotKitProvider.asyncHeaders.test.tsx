import React, { useEffect } from "react";
import { render, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider, useCopilotKit } from "../CopilotKitProvider";
import { useLearningContainers } from "../../hooks/use-learning-containers";
import type {
  HeaderRecord,
  HeaderSource,
} from "../../hooks/use-resolved-headers";

const RUNTIME_URL = "https://runtime.example/rest";

const throwingHeaderSource = () => {
  throw new Error("header builder failed");
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function HeaderProbe({
  onHeaders,
}: {
  onHeaders: (headers: HeaderRecord) => void;
}) {
  const { copilotkit } = useCopilotKit();
  const headers = copilotkit.headers;
  useEffect(() => {
    onHeaders({ ...headers });
  }, [headers, onHeaders]);
  return null;
}

function LearningProbe() {
  useLearningContainers({
    threadId: "learning-thread",
    learningContainers: ["team"],
  });
  return null;
}

describe("CopilotKitProvider async headers", () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "1.0.0", agents: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  const infoCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes("/info"));

  it("waits for async headers before the first /info request", async () => {
    const pending = deferred<HeaderRecord>();
    render(
      <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        useSingleEndpoint={false}
        headers={() => pending.promise}
      >
        child
      </CopilotKitProvider>,
    );

    expect(infoCalls()).toHaveLength(0);
    act(() => pending.resolve({ Authorization: "Bearer issue-1937" }));

    await waitFor(() => expect(infoCalls()).toHaveLength(1));
    const requestHeaders = new Headers(infoCalls()[0]![1]?.headers);
    expect(requestHeaders.get("Authorization")).toBe("Bearer issue-1937");
  });

  it("defers runtime URL and transport changes until async headers settle", async () => {
    const pending = deferred<HeaderRecord>();
    const source = () => pending.promise;
    const view = render(
      <CopilotKitProvider
        publicApiKey="cloud-key"
        useSingleEndpoint={false}
        headers={source}
      >
        child
      </CopilotKitProvider>,
    );

    view.rerender(
      <CopilotKitProvider
        publicApiKey="cloud-key"
        runtimeUrl={RUNTIME_URL}
        useSingleEndpoint
        headers={source}
      >
        child
      </CopilotKitProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => pending.resolve({ Authorization: "Bearer late-runtime" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    for (const [, request] of fetchMock.mock.calls) {
      expect(new Headers(request?.headers).get("Authorization")).toBe(
        "Bearer late-runtime",
      );
    }
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      RUNTIME_URL,
      RUNTIME_URL,
    ]);
  });

  it("holds child annotation requests until settled headers are active", async () => {
    const pending = deferred<HeaderRecord>();
    render(
      <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        headers={() => pending.promise}
      >
        <LearningProbe />
      </CopilotKitProvider>,
    );

    const annotateCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/annotate"));
    expect(annotateCalls()).toHaveLength(0);

    act(() => pending.resolve({ Authorization: "Bearer annotation" }));
    await waitFor(() => expect(annotateCalls()).toHaveLength(1));
    expect(
      new Headers(annotateCalls()[0]![1]?.headers).get("Authorization"),
    ).toBe("Bearer annotation");
  });

  it("reports an initial rejection and retries with a new source", async () => {
    const pending = deferred<HeaderRecord>();
    const onError = vi.fn();
    const view = render(
      <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        headers={() => pending.promise}
        onError={onError}
      >
        child
      </CopilotKitProvider>,
    );

    act(() => pending.reject(new Error("header service unavailable")));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(infoCalls()).toHaveLength(0);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      code: "runtime_info_fetch_failed",
      context: { source: "headers", runtimeUrl: RUNTIME_URL },
    });

    view.rerender(
      <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        headers={() => ({ Authorization: "Bearer retry" })}
        onError={onError}
      >
        child
      </CopilotKitProvider>,
    );
    await waitFor(() => expect(infoCalls()).toHaveLength(1));
    expect(new Headers(infoCalls()[0]![1]?.headers).get("Authorization")).toBe(
      "Bearer retry",
    );
  });

  it("reports a synchronous throw and retries without sending undefined", async () => {
    const onError = vi.fn();
    const view = render(
      <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        headers={throwingHeaderSource}
        onError={onError}
      >
        child
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(infoCalls()).toHaveLength(0);

    view.rerender(
      <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        headers={() => ({ Authorization: "Bearer recovered" })}
        onError={onError}
      >
        child
      </CopilotKitProvider>,
    );
    await waitFor(() => expect(infoCalls()).toHaveLength(1));
    expect(new Headers(infoCalls()[0]![1]?.headers).get("Authorization")).toBe(
      "Bearer recovered",
    );
  });

  it("keeps the async initial connection single under StrictMode", async () => {
    const pending = deferred<HeaderRecord>();
    const source = () => pending.promise;
    render(
      <React.StrictMode>
        <CopilotKitProvider
          runtimeUrl={RUNTIME_URL}
          useSingleEndpoint={false}
          headers={source}
        >
          child
        </CopilotKitProvider>
      </React.StrictMode>,
    );

    expect(infoCalls()).toHaveLength(0);
    act(() => pending.resolve({ Authorization: "Bearer strict" }));
    await waitFor(() => expect(infoCalls()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(infoCalls()).toHaveLength(1);
  });

  it("preserves static and synchronous header timing and values", async () => {
    render(
      <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        useSingleEndpoint={false}
        headers={{ Authorization: "Bearer static" }}
      >
        child
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(infoCalls()).toHaveLength(1));
    expect(new Headers(infoCalls()[0]![1]?.headers).get("Authorization")).toBe(
      "Bearer static",
    );
  });

  it("preserves an explicit cloud-key header regardless of casing", async () => {
    render(
      <CopilotKitProvider
        runtimeUrl={RUNTIME_URL}
        useSingleEndpoint={false}
        publicApiKey="public-key"
        headers={{ "x-copilotcloud-public-api-key": "explicit-key" }}
      >
        child
      </CopilotKitProvider>,
    );

    await waitFor(() => expect(infoCalls()).toHaveLength(1));
    const requestHeaders = infoCalls()[0]![1]?.headers as Record<
      string,
      string
    >;
    expect(
      Object.keys(requestHeaders).filter(
        (key) => key.toLowerCase() === "x-copilotcloud-public-api-key",
      ),
    ).toHaveLength(1);
    expect(
      new Headers(requestHeaders).get("x-copilotcloud-public-api-key"),
    ).toBe("explicit-key");
  });

  it("applies the latest refresh and retains the last good record on rejection", async () => {
    const initial = deferred<HeaderRecord>();
    const refresh = deferred<HeaderRecord>();
    const stale = deferred<HeaderRecord>();
    const observed: HeaderRecord[] = [];
    let source: HeaderSource = () => initial.promise;
    const view = render(
      <CopilotKitProvider runtimeUrl={RUNTIME_URL} headers={source}>
        <HeaderProbe onHeaders={(headers) => observed.push(headers)} />
      </CopilotKitProvider>,
    );

    act(() => initial.resolve({ Authorization: "Bearer initial" }));
    await waitFor(() =>
      expect(observed).toContainEqual({ Authorization: "Bearer initial" }),
    );

    source = () => refresh.promise;
    view.rerender(
      <CopilotKitProvider runtimeUrl={RUNTIME_URL} headers={source}>
        <HeaderProbe onHeaders={(headers) => observed.push(headers)} />
      </CopilotKitProvider>,
    );
    source = () => stale.promise;
    view.rerender(
      <CopilotKitProvider runtimeUrl={RUNTIME_URL} headers={source}>
        <HeaderProbe onHeaders={(headers) => observed.push(headers)} />
      </CopilotKitProvider>,
    );

    act(() => stale.resolve({ Authorization: "Bearer latest" }));
    await waitFor(() =>
      expect(observed).toContainEqual({ Authorization: "Bearer latest" }),
    );
    act(() => refresh.resolve({ Authorization: "Bearer stale" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(observed.at(-1)).toEqual({ Authorization: "Bearer latest" });

    const rejected = deferred<HeaderRecord>();
    source = () => rejected.promise;
    view.rerender(
      <CopilotKitProvider runtimeUrl={RUNTIME_URL} headers={source}>
        <HeaderProbe onHeaders={(headers) => observed.push(headers)} />
      </CopilotKitProvider>,
    );
    act(() => rejected.reject(new Error("Bearer secret")));
    await waitFor(() =>
      expect(observed.at(-1)).toEqual({
        Authorization: "Bearer latest",
      }),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[CopilotKit] Failed to resolve request headers",
    );
  });
});
