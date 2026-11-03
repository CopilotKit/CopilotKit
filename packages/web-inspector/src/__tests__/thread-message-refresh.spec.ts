import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { CpkThreadInspector } from "../index.js";
import type {
  ThreadDebuggerMessage,
  ThreadDebuggerProvider,
} from "../index.js";

type Transport = "runtime" | "provider";
type RequestRecord = {
  threadId: string;
  startedAt: number;
  signal: AbortSignal;
  settled: boolean;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  document.body.replaceChildren();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flush(detail: CpkThreadInspector): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) {
    await Promise.resolve();
    await detail.updateComplete;
  }
}

async function advance(
  detail: CpkThreadInspector,
  milliseconds: number,
): Promise<void> {
  await vi.advanceTimersByTimeAsync(milliseconds);
  await flush(detail);
}

function mount(
  transport: Transport,
  latency: number | ((threadId: string) => number) = 200,
) {
  const requests: RequestRecord[] = [];
  const content = new Map([["thread-a", "Initial answer"]]);
  let outstanding = 0;
  let maxOutstanding = 0;
  let abortedWhilePending = 0;

  const loadMessages = (threadId: string, signal: AbortSignal) => {
    const request = { threadId, signal, startedAt: Date.now(), settled: false };
    requests.push(request);
    outstanding += 1;
    maxOutstanding = Math.max(maxOutstanding, outstanding);
    signal.addEventListener("abort", () => {
      if (!request.settled) abortedWhilePending += 1;
    });
    // Snapshot when work starts. An update arriving during this request must
    // cause a trailing refresh to obtain the final answer.
    const messages: ThreadDebuggerMessage[] = [
      {
        id: `${threadId}-reply`,
        role: "assistant",
        content: content.get(threadId) ?? "Initial answer",
      },
    ];
    return new Promise<ThreadDebuggerMessage[]>((resolve) => {
      setTimeout(
        () => {
          request.settled = true;
          outstanding -= 1;
          resolve(messages);
        },
        typeof latency === "number" ? latency : latency(threadId),
      );
    });
  };

  // The fake server deliberately continues its work after browser aborts.
  // This makes overlapping server work visible instead of treating abort as
  // proof that the original query stopped.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/events")) {
        return new Response(null, { status: 501 });
      }
      const match = /^\/threads\/([^/]+)\/messages$/.exec(url.pathname);
      if (!match || !options?.signal) {
        throw new Error(`Unexpected fetch: ${url}`);
      }
      const messages = await loadMessages(
        decodeURIComponent(match[1]!),
        options.signal,
      );
      return Response.json({ messages });
    }),
  );

  const detail = new CpkThreadInspector();
  detail.threadId = "thread-a";
  if (transport === "provider") {
    detail.provider = {
      getMessages: (threadId, options) => {
        if (!options?.signal) throw new Error("Missing provider abort signal");
        return loadMessages(threadId, options.signal);
      },
    };
  } else {
    detail.runtimeUrl = "https://runtime.example.test";
    detail.threadInspectionAvailable = true;
  }
  document.body.append(detail);

  return {
    detail,
    requests,
    content,
    summary: () => ({
      transport,
      messageLoads: requests.length,
      maxOutstanding,
      abortedWhilePending,
    }),
    async change(version: number) {
      content.set("thread-a", `Streamed answer ${version}`);
      detail.liveMessageVersion = version;
      await flush(detail);
    },
  };
}

test.each<Transport>(["runtime", "provider"])(
  "%s: 50 streaming updates produce bounded requests and a final answer",
  async (transport) => {
    const harness = mount(transport);
    await flush(harness.detail);
    await advance(harness.detail, 200);

    for (let version = 1; version <= 50; version += 1) {
      await harness.change(version);
      await advance(harness.detail, 20);
    }
    await advance(harness.detail, 3_000);

    const summary = harness.summary();
    console.log("streaming request comparison", JSON.stringify(summary));
    expect(summary.messageLoads, JSON.stringify(summary)).toBeLessThanOrEqual(
      3,
    );
    expect(summary.maxOutstanding).toBe(1);
    expect(summary.abortedWhilePending).toBe(0);
    const refreshes = harness.requests.slice(1);
    for (let index = 1; index < refreshes.length; index += 1) {
      expect(
        refreshes[index]!.startedAt - refreshes[index - 1]!.startedAt,
      ).toBeGreaterThanOrEqual(1_000);
    }
    expect(harness.detail.shadowRoot?.textContent).toContain(
      "Streamed answer 50",
    );
    const settledCount = harness.requests.length;
    await advance(harness.detail, 10_000);
    expect(harness.requests).toHaveLength(settledCount);
  },
);

test.each<Transport>(["runtime", "provider"])(
  "%s: a slow initial request queues one refresh without aborting it",
  async (transport) => {
    const harness = mount(transport, 1_500);
    await flush(harness.detail);
    for (let version = 1; version <= 50; version += 1) {
      await harness.change(version);
      await advance(harness.detail, 20);
    }
    await advance(harness.detail, 400);
    const summary = harness.summary();
    expect(summary.messageLoads, JSON.stringify(summary)).toBe(1);
    expect(harness.requests[0]!.signal.aborted).toBe(false);

    await advance(harness.detail, 3_000);
    expect(harness.requests).toHaveLength(2);
    expect(harness.summary().maxOutstanding).toBe(1);
    expect(harness.detail.shadowRoot?.textContent).toContain(
      "Streamed answer 50",
    );
  },
);

test.each<Transport>(["runtime", "provider"])(
  "%s: switching threads cancels old work and ignores late results",
  async (transport) => {
    const harness = mount(transport, (threadId) =>
      threadId === "thread-a" ? 5_000 : 100,
    );
    await flush(harness.detail);
    await harness.change(1);
    await advance(harness.detail, 20);
    await harness.change(2);
    const oldRequests = [...harness.requests];

    harness.content.set("thread-b", "The selected thread answer");
    harness.detail.threadId = "thread-b";
    await flush(harness.detail);
    expect(oldRequests.every((request) => request.signal.aborted)).toBe(true);
    await advance(harness.detail, 6_000);
    expect(
      harness.requests.filter((request) => request.threadId === "thread-a"),
    ).toHaveLength(oldRequests.length);
    expect(
      harness.requests.filter((request) => request.threadId === "thread-b"),
    ).toHaveLength(1);
    expect(harness.detail.shadowRoot?.textContent).toContain(
      "The selected thread answer",
    );
    expect(harness.detail.shadowRoot?.textContent).not.toContain(
      "Streamed answer",
    );
  },
);

test.each<Transport>(["runtime", "provider"])(
  "%s: disconnect cancels scheduled refreshes and reconnect loads once",
  async (transport) => {
    const harness = mount(transport, 100);
    await flush(harness.detail);
    await advance(harness.detail, 100);
    await harness.change(1);
    await harness.change(2);
    harness.detail.remove();
    const countAtDisconnect = harness.requests.length;
    expect(
      harness.requests.every(
        (request) => request.settled || request.signal.aborted,
      ),
    ).toBe(true);
    await advance(harness.detail, 5_000);
    expect(harness.requests).toHaveLength(countAtDisconnect);

    document.body.append(harness.detail);
    await flush(harness.detail);
    await advance(harness.detail, 2_000);
    expect(harness.requests).toHaveLength(countAtDisconnect + 1);
    expect(harness.detail.shadowRoot?.textContent).toContain(
      "Streamed answer 2",
    );
  },
);

test("a hosted provider without live version updates never polls", async () => {
  const harness = mount("provider");
  await flush(harness.detail);
  await advance(harness.detail, 200);
  for (let update = 0; update < 10; update += 1) {
    harness.detail.requestUpdate();
    await flush(harness.detail);
  }
  await advance(harness.detail, 60_000);
  expect(harness.requests).toHaveLength(1);
  expect(harness.detail.shadowRoot?.textContent).toContain("Initial answer");
});

test("switching providers for the same thread discards a queued refresh", async () => {
  const harness = mount("provider", 100);
  await flush(harness.detail);
  await advance(harness.detail, 100);
  await harness.change(1);

  const getMessages = vi.fn(async () => [
    { id: "new-reply", role: "assistant", content: "New provider answer" },
  ]);
  harness.detail.provider = { getMessages };
  await flush(harness.detail);
  expect(getMessages).toHaveBeenCalledOnce();
  await advance(harness.detail, 5_000);

  expect(harness.requests).toHaveLength(1);
  expect(getMessages).toHaveBeenCalledOnce();
  expect(harness.detail.shadowRoot?.textContent).toContain(
    "New provider answer",
  );
  expect(harness.detail.shadowRoot?.textContent).not.toContain(
    "Streamed answer",
  );
});

test("a late old provider cannot release the replacement's pending request", async () => {
  const harness = mount("provider", 1_000);
  await flush(harness.detail);
  await harness.change(1);

  let resolveReplacement!: (messages: ThreadDebuggerMessage[]) => void;
  const getMessages = vi
    .fn<NonNullable<ThreadDebuggerProvider["getMessages"]>>()
    .mockImplementationOnce(
      () =>
        new Promise<ThreadDebuggerMessage[]>((resolve) => {
          resolveReplacement = resolve;
        }),
    )
    .mockResolvedValue([
      {
        id: "new-reply",
        role: "assistant",
        content: "Final new provider answer",
      },
    ]);
  harness.detail.provider = { getMessages };
  await flush(harness.detail);
  expect(harness.requests[0]!.signal.aborted).toBe(true);
  await harness.change(2);
  await advance(harness.detail, 1_000);
  expect(harness.requests[0]!.settled).toBe(true);

  // The old provider ignored abort and settled while the new one was active.
  // A later update must still wait for the new request, not replace it.
  await harness.change(3);
  await advance(harness.detail, 1_000);
  expect(getMessages).toHaveBeenCalledOnce();
  expect(getMessages.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
  expect(harness.detail.shadowRoot?.textContent).toContain("Loading messages…");
  expect(harness.detail.shadowRoot?.textContent).not.toContain(
    "Initial answer",
  );

  resolveReplacement([
    { id: "new-reply", role: "assistant", content: "New provider snapshot" },
  ]);
  await flush(harness.detail);
  await advance(harness.detail, 1);
  expect(getMessages).toHaveBeenCalledTimes(2);
  expect(harness.detail.shadowRoot?.textContent).toContain(
    "Final new provider answer",
  );
  await advance(harness.detail, 5_000);
  expect(getMessages).toHaveBeenCalledTimes(2);
});
