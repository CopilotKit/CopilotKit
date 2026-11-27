// The booker's side of the channel demo booking (shell-docs
// src/lib/early-access/post-booking.ts): how it reads the proxy's answer,
// and the deadline on the request and its answer. fetch is mocked: nothing
// here reaches the docs' proxy, the website, or Calendly.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ChannelDemoBookRequest } from "../../../shell-docs/src/lib/early-access/booking";
import { postBooking } from "../../../shell-docs/src/lib/early-access/post-booking";

const REQUEST: ChannelDemoBookRequest = {
  channel: "whatsapp",
  startTime: "2026-12-02T17:00:00Z",
  name: "Jane Doe",
  email: "jane@acme.dev",
  company: "Acme",
  timeZone: "America/New_York",
};

const BOOKING = {
  startTime: REQUEST.startTime,
  rescheduleUrl: "https://calendly.com/reschedulings/abc",
  cancelUrl: "https://calendly.com/cancellations/abc",
  hosts: ["Ada"],
};

/** The booker's deadline for the request and its answer. */
const DEADLINE_MS = 40_000;

const json = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Mocks the proxy's answer to every fetch, and records the requests. */
function proxy(answer: (init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (_url: URL | string, init?: RequestInit) =>
    answer(init),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Calls `fail` once `signal` aborts, as fetch fails then. */
function onAbort(
  signal: AbortSignal | null | undefined,
  fail: (reason: unknown) => void,
) {
  signal?.addEventListener("abort", () => fail(signal.reason));
}

/** What `promise` has resolved to so far: undefined while it's pending. */
function watch<T>(promise: Promise<T>) {
  const seen: { value?: T } = {};
  void promise.then((value) => {
    seen.value = value;
  });
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the proxy's answer", () => {
  test("books with one request", async () => {
    const fetchMock = proxy(() => json(200, { ok: true, booking: BOOKING }));
    expect(await postBooking(REQUEST)).toEqual({ ok: true, booking: BOOKING });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/channel-demo/book");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual(REQUEST);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([
    [
      "the proxy's own failure",
      409,
      { ok: false, code: "slot_taken" },
      { ok: false, code: "slot_taken" },
    ],
    [
      "an edge's bare 429",
      429,
      "Too Many Requests",
      { ok: false, code: "rate_limited" },
    ],
    [
      "another refusal, which booked nothing",
      403,
      "<html>Forbidden</html>",
      { ok: false, code: "unavailable" },
    ],
    [
      "a gateway's error, which may have booked",
      502,
      "<html>Bad gateway</html>",
      { ok: false, code: "unconfirmed" },
    ],
    [
      "an answer that isn't a booking",
      200,
      { ok: true },
      { ok: false, code: "unconfirmed" },
    ],
  ] as const)("reads %s", async (_name, status, body, expected) => {
    proxy(() => json(status, body));
    expect(await postBooking(REQUEST)).toEqual(expected);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a request that fails may have booked", async () => {
    proxy(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await postBooking(REQUEST)).toEqual({
      ok: false,
      code: "unconfirmed",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the deadline", () => {
  test("a request with no answer is unconfirmed at the deadline, and isn't sent again", async () => {
    const fetchMock = proxy(
      (init) =>
        new Promise((_resolve, reject) => onAbort(init?.signal, reject)),
    );
    const answer = watch(postBooking(REQUEST));
    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    expect(answer.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer.value).toEqual({ ok: false, code: "unconfirmed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("an answer whose body stops arriving is unconfirmed at the deadline", async () => {
    proxy(
      (init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"ok":true,'));
              onAbort(init?.signal, (reason) => controller.error(reason));
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const answer = watch(postBooking(REQUEST));
    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    expect(answer.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer.value).toEqual({ ok: false, code: "unconfirmed" });
    expect(vi.getTimerCount()).toBe(0);
  });

  test("an answer just inside the deadline is read as usual", async () => {
    proxy(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(json(200, { ok: true, booking: BOOKING })),
            DEADLINE_MS - 1_000,
          ),
        ),
    );
    const answer = watch(postBooking(REQUEST));
    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1_000);
    expect(answer.value).toEqual({ ok: true, booking: BOOKING });
    expect(vi.getTimerCount()).toBe(0);
  });
});
