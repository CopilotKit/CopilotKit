import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DATA_PROBE,
  FILE_PROBE,
  androidLike,
  answerAfter,
  bufferedResponse,
  neverAnswers,
  setupEnvironment,
  streamingResponse,
  type ProbeAnswer,
} from "./helpers/streaming-fetch-harness";

/**
 * The capability check has a short deadline that starts when the first probe
 * request is issued, not at import. A busy JS thread at app start (modelled
 * with `busyMs`) therefore cannot use it up. Once the deadline has passed the
 * fetch is not switched again: a later answer is ignored. All waits are exact
 * virtual milliseconds (vitest fake timers).
 */
const DEADLINE_MS = 2_000;
const BUSY_MS = 1_500; // what Android's cold start showed: the probe is issued at +0.96..1.88 s

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe(`${DEADLINE_MS} ms deadline from the first probe request`, () => {
  describe("1. the probe answers at once (streams)", () => {
    it("keeps the native fetch and sends the early request once, without waiting", async () => {
      const env = await setupEnvironment(answerAfter(0, streamingResponse));
      const early = env.issue();
      await vi.advanceTimersByTimeAsync(0);

      expect(env.fetchKind()).toBe("native");
      expect(await early.response).toBe(env.nativeResponse);
      expect(env.deliveries(early.marker)).toEqual({ native: 1, shim: 0 });
      expect(env.deliveryTime(early.marker)! - early.issuedAt).toBe(0);
      expect(env.probeCalls.map((call) => call.url)).toEqual([DATA_PROBE]);
      expect(env.xhrs).toHaveLength(0);
    });
  });

  describe("2. the deadline starts when the probe is issued, not at import", () => {
    it("does not run out during a busy start: the Android case, answer 0.3 s after the probe was issued", async () => {
      const env = await setupEnvironment(answerAfter(300, streamingResponse), {
        busyMs: BUSY_MS,
      });
      const early = env.issue(); // made as soon as the thread is free
      const transitions = await env.trace(500);

      expect(transitions).toEqual([
        { t: 0, kind: "pending" },
        { t: 300, kind: "native" },
      ]);
      expect(env.deliveryTime(early.marker)! - early.issuedAt).toBe(300);
      expect(env.deliveries(early.marker)).toEqual({ native: 1, shim: 0 });
      expect(env.xhrs).toHaveLength(0);
    });

    it("arms nothing before the probe request exists, then exactly one timer", async () => {
      const env = await setupEnvironment(neverAnswers, { busyMs: BUSY_MS });
      let decided = false;
      void env.ready.then(() => {
        decided = true;
      });
      // The 1.5 s of busy time did not touch the deadline.
      await vi.advanceTimersByTimeAsync(0);
      expect(decided).toBe(false);
      expect(env.leaks().timers).toBe(1);
      await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
      expect(decided).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(decided).toBe(true);
      expect(env.fetchKind()).toBe("shim");
    });

    it("a long busy start (5 s) changes nothing", async () => {
      const env = await setupEnvironment(answerAfter(300, streamingResponse), {
        busyMs: 5_000,
      });
      await vi.advanceTimersByTimeAsync(300);

      expect(env.fetchKind()).toBe("native");
    });
  });

  describe("3. the probe answers after the deadline (counted from the probe request)", () => {
    it("selects the shim at the deadline and ignores the late answer (no late win)", async () => {
      const env = await setupEnvironment(
        answerAfter(DEADLINE_MS + 600, streamingResponse),
        { busyMs: BUSY_MS },
      );
      const early = env.issue();
      const transitions = await env.trace(DEADLINE_MS + 1_000);

      expect(transitions).toEqual([
        { t: 0, kind: "pending" },
        { t: DEADLINE_MS, kind: "shim" },
      ]);
      expect(env.deliveryTime(early.marker)! - early.issuedAt).toBe(DEADLINE_MS);
      expect(env.deliveries(early.marker)).toEqual({ native: 0, shim: 1 });
      expect(env.probeCalls[0].signal?.aborted).toBe(true);
    });

    it("keeps the native fetch for an answer one millisecond inside the deadline", async () => {
      const env = await setupEnvironment(
        answerAfter(DEADLINE_MS - 1, streamingResponse),
        { busyMs: BUSY_MS },
      );
      await vi.advanceTimersByTimeAsync(DEADLINE_MS);

      expect(env.fetchKind()).toBe("native");
    });

    it("Android's rejected data: probe then readable file: 404, 1.6 s after the probe was issued", async () => {
      const env = await setupEnvironment(androidLike(1_584, 16), {
        busyMs: BUSY_MS,
      });
      const early = env.issue();
      const transitions = await env.trace(2_500);

      expect(transitions).toEqual([
        { t: 0, kind: "pending" },
        { t: 1_600, kind: "native" },
      ]);
      expect(env.deliveries(early.marker)).toEqual({ native: 1, shim: 0 });
      expect(env.probeCalls.map((call) => call.url)).toEqual([
        DATA_PROBE,
        FILE_PROBE,
      ]);
    });
  });

  describe("4. the probe says the fetch does not stream", () => {
    it("selects the shim at once and sends the early request through it once", async () => {
      const env = await setupEnvironment(answerAfter(0, bufferedResponse));
      const early = env.issue();
      await vi.advanceTimersByTimeAsync(0);

      expect(env.fetchKind()).toBe("shim");
      expect(env.deliveries(early.marker)).toEqual({ native: 0, shim: 1 });
      expect(env.deliveryTime(early.marker)! - early.issuedAt).toBe(0);
      expect(env.nativeAppCalls).toHaveLength(0);
    });
  });

  describe("5. the probe never answers", () => {
    it("holds a request made at start for exactly the deadline, then uses the shim", async () => {
      const env = await setupEnvironment(neverAnswers);
      const early = env.issue();
      const transitions = await env.trace(DEADLINE_MS + 5);

      expect(transitions).toEqual([
        { t: 0, kind: "pending" },
        { t: DEADLINE_MS, kind: "shim" },
      ]);
      expect(env.deliveryTime(early.marker)! - early.issuedAt).toBe(DEADLINE_MS);
      expect(env.deliveries(early.marker)).toEqual({ native: 0, shim: 1 });
      expect(env.probeCalls[0].signal?.aborted).toBe(true);
    });

    it("after a busy start the first request still waits only the deadline", async () => {
      const env = await setupEnvironment(neverAnswers, { busyMs: BUSY_MS });
      const early = env.issue();
      await vi.advanceTimersByTimeAsync(DEADLINE_MS + 5);

      expect(env.deliveryTime(early.marker)! - early.issuedAt).toBe(DEADLINE_MS);
    });

    it("bounds the wait by the time left, and later requests do not wait at all", async () => {
      const env = await setupEnvironment(neverAnswers);
      await vi.advanceTimersByTimeAsync(400);
      const mid = env.issue();
      await vi.advanceTimersByTimeAsync(DEADLINE_MS - 400);
      const late = env.issue();
      await vi.advanceTimersByTimeAsync(0);

      expect(env.deliveryTime(mid.marker)! - mid.issuedAt).toBe(
        DEADLINE_MS - 400,
      );
      expect(env.deliveryTime(late.marker)! - late.issuedAt).toBe(0);
    });
  });

  describe("6. web/native fetch with a body", () => {
    const init = {
      method: "POST",
      headers: { "x-test": "preserved" },
      body: "payload",
    };

    it("passes the exact arguments to the native fetch, bound to the global", async () => {
      const env = await setupEnvironment(answerAfter(0, streamingResponse));
      await vi.advanceTimersByTimeAsync(0);
      await globalThis.fetch("https://api.test/run", init);

      expect(env.nativeAppCalls).toHaveLength(1);
      expect(env.nativeAppCalls[0].input).toBe("https://api.test/run");
      expect(env.nativeAppCalls[0].init).toBe(init);
      expect(env.nativeAppCalls[0].thisArg).toBe(globalThis);
    });

    it("sends the body and headers through the shim", async () => {
      const env = await setupEnvironment(answerAfter(0, bufferedResponse));
      await vi.advanceTimersByTimeAsync(0);
      void globalThis.fetch("https://api.test/run", init);

      expect(env.xhrs).toHaveLength(1);
      expect(env.xhrs[0].open).toHaveBeenCalledExactlyOnceWith(
        "POST",
        "https://api.test/run",
      );
      expect(env.xhrs[0].setRequestHeader).toHaveBeenCalledExactlyOnceWith(
        "x-test",
        "preserved",
      );
      expect(env.xhrs[0].send).toHaveBeenCalledExactlyOnceWith("payload");
    });
  });

  describe("7. duplicates: every request made during detection reaches one fetch once", () => {
    const scenarios: [string, ProbeAnswer, number][] = [
      ["streams at once", answerAfter(0, streamingResponse), 0],
      [
        "streams 0.3 s after the probe, after a busy start",
        answerAfter(300, streamingResponse),
        BUSY_MS,
      ],
      [
        "streams after the deadline (ignored)",
        answerAfter(DEADLINE_MS + 600, streamingResponse),
        BUSY_MS,
      ],
      ["does not stream", answerAfter(0, bufferedResponse), 0],
      ["never answers", neverAnswers, BUSY_MS],
    ];
    const moments = [
      200, DEADLINE_MS - 1, DEADLINE_MS, DEADLINE_MS + 1, DEADLINE_MS + 599,
      DEADLINE_MS + 600, DEADLINE_MS + 601, 9_999, 10_000, 12_000,
    ];

    it.each(scenarios)("%s", async (_name, probe, busyMs) => {
      const env = await setupEnvironment(probe, { busyMs });
      // Five concurrent early requests in the same tick, then requests at
      // every boundary of the probe's possible timeline.
      const issued = Array.from({ length: 5 }, () => env.issue());
      const start = issued[0].issuedAt;
      for (const at of moments) {
        await vi.advanceTimersByTimeAsync(at - (Date.now() - start));
        issued.push(env.issue());
      }
      await vi.advanceTimersByTimeAsync(2_000);
      for (const xhr of env.xhrs) await env.completeXhr(xhr);
      const responses = await Promise.all(issued.map((i) => i.response));

      expect(responses).toHaveLength(5 + moments.length);
      for (const { marker } of issued) {
        const { native, shim } = env.deliveries(marker);
        expect({ marker, total: native + shim }).toEqual({ marker, total: 1 });
      }
      // Nothing was sent that the application did not ask for.
      expect(env.nativeAppCalls.length + env.xhrs.length).toBe(issued.length);
    });
  });

  describe("8. nothing keeps running afterwards", () => {
    const scenarios: [string, ProbeAnswer, number][] = [
      ["streams at once", answerAfter(0, streamingResponse), 0],
      ["streams after a busy start", answerAfter(300, streamingResponse), BUSY_MS],
      ["does not stream", answerAfter(0, bufferedResponse), 0],
      ["never answers", neverAnswers, BUSY_MS],
      [
        "answers after the deadline",
        answerAfter(DEADLINE_MS + 600, streamingResponse),
        0,
      ],
    ];

    it.each(scenarios)("%s", async (_name, probe, busyMs) => {
      const env = await setupEnvironment(probe, { busyMs });
      const early = env.issue();
      await vi.advanceTimersByTimeAsync(DEADLINE_MS + 700);
      for (const xhr of env.xhrs) await env.completeXhr(xhr);
      await early.response;

      expect(env.leaks()).toEqual({ timers: 0, liveProbes: 0 });
    });
  });
});
