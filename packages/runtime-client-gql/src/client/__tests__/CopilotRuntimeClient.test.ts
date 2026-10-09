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
