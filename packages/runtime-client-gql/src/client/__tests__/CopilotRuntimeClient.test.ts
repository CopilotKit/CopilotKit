import { describe, expect, it, vi } from "vitest";
import { CopilotRuntimeClient } from "../CopilotRuntimeClient";
import { CopilotKitLowLevelError } from "@copilotkit/shared";

type Settled<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

const readStream = async (stream: ReadableStream<unknown>) => {
  const reader = stream.getReader();
  const chunks: unknown[] = [];

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        return { status: "done", chunks } as const;
      }
      chunks.push(result.value);
    }
  } catch (error) {
    return { status: "error", error } as const;
  }
};

const settle = async <T>(promise: Promise<T>): Promise<Settled<T>> => {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
};

describe("CopilotRuntimeClient abort suppression", () => {
  const makeClient = () =>
    new CopilotRuntimeClient({ url: "https://example.com/runtime" });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not throw when fetch rejects with a string abort cause", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      "signal is aborted without reason",
    );

    const result = await settle(
      makeClient()
        .generateCopilotResponse({
          data: {} as any,
          properties: {} as any,
        })
        .toPromise(),
    );

    expect(result.status).toBe("fulfilled");
    expect(result.value).toMatchObject({
      error: {
        name: "CombinedError",
        networkError: expect.any(CopilotKitLowLevelError),
      },
    });
  });

  it("wraps non-message abort causes in low-level error in fetch wrapper", async () => {
    const fetchError = { reason: "timeout" } as any;
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(fetchError);

    const result = await settle(
      makeClient()
        .generateCopilotResponse({
          data: {} as any,
          properties: {} as any,
        })
        .toPromise(),
    );

    expect(result.status).toBe("fulfilled");
    expect(result.value).toMatchObject({
      error: {
        networkError: expect.any(CopilotKitLowLevelError),
      },
    });
  });

  it("suppresses abort errors in stream errors without message access", async () => {
    const stream = makeClient().asStream({
      subscribe: (next) => {
        next({
          data: undefined,
          hasNext: false,
          error: new Error("signal is aborted without reason"),
        });
      },
    } as any);

    expect(await readStream(stream)).toEqual({
      status: "done",
      chunks: [],
    });
  });

  it("surfaces non-string error objects in stream errors without throwing", async () => {
    const streamError = { code: "network" } as any;
    const stream = makeClient().asStream({
      subscribe: (next) => {
        next({
          data: undefined,
          hasNext: false,
          error: streamError,
        });
      },
    } as any);

    expect(await readStream(stream)).toEqual({
      status: "error",
      error: streamError,
    });
  });
});

// Resolves to `sentinel` when the stream never settles, so a hang surfaces as a
// fast, readable assertion failure instead of a vitest timeout.
const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  sentinel: T,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(sentinel), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const structuredError = () =>
  Object.assign(new Error("boom"), {
    extensions: { visibility: "banner" },
  });

describe("CopilotRuntimeClient structured stream errors", () => {
  it("terminates the stream when a structured error arrives with no handler", async () => {
    const streamError = structuredError();

    const stream = new CopilotRuntimeClient({
      url: "https://example.com/runtime",
    }).asStream({
      subscribe: (next) => {
        next({
          data: undefined,
          hasNext: false,
          error: streamError,
        });
      },
    } as any);

    expect(
      await withTimeout(readStream(stream), 250, { status: "hang" } as any),
    ).toEqual({ status: "error", error: streamError });
  });

  it("terminates the stream when a structured error arrives with a handler", async () => {
    const handleGQLErrors = vi.fn();
    const streamError = structuredError();

    const stream = new CopilotRuntimeClient({
      url: "https://example.com/runtime",
      handleGQLErrors,
    }).asStream({
      subscribe: (next) => {
        next({
          data: undefined,
          hasNext: false,
          error: streamError,
        });
      },
    } as any);

    expect(
      await withTimeout(readStream(stream), 250, { status: "hang" } as any),
    ).toEqual({ status: "done", chunks: [] });
    expect(handleGQLErrors).toHaveBeenCalledTimes(1);
  });
});
