import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry, parseRetryAfter, RETRY_CONFIG } from "../retry-utils";

function responseWithRetryAfter(
  headerValue: string | null,
  status = 429,
): Response {
  const headers = new Headers();
  if (headerValue !== null) headers.set("Retry-After", headerValue);
  return new Response(null, { status, headers });
}

describe("parseRetryAfter", () => {
  it("returns undefined when the Retry-After header is absent", () => {
    expect(parseRetryAfter(responseWithRetryAfter(null))).toBeUndefined();
  });

  it("parses integer seconds into milliseconds", () => {
    expect(parseRetryAfter(responseWithRetryAfter("5"))).toBe(5000);
  });

  it("treats zero seconds as zero delay", () => {
    expect(parseRetryAfter(responseWithRetryAfter("0"))).toBe(0);
  });

  it("clamps a negative numeric value to zero", () => {
    // `-1` fails the `seconds >= 0` guard and falls through to Date.parse,
    // which interprets it as a year-in-the-past timestamp; the past-date
    // branch then clamps to 0. The behavior is lenient rather than strict.
    expect(parseRetryAfter(responseWithRetryAfter("-1"))).toBe(0);
  });

  it("parses an HTTP-date in the future as the delta to now", () => {
    const now = Date.parse("2026-04-22T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const future = new Date(now + 30_000).toUTCString();
      expect(parseRetryAfter(responseWithRetryAfter(future))).toBe(30_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps an HTTP-date in the past to zero", () => {
    const now = Date.parse("2026-04-22T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      const past = new Date(now - 60_000).toUTCString();
      expect(parseRetryAfter(responseWithRetryAfter(past))).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns undefined for unparseable values", () => {
    expect(parseRetryAfter(responseWithRetryAfter("soon"))).toBeUndefined();
  });
});

describe("fetchWithRetry Retry-After handling (#3637)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("honors Retry-After within the allowed maximum on 429", async () => {
    fetchMock
      .mockResolvedValueOnce(responseWithRetryAfter("2"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const promise = fetchWithRetry("https://example.com", {});
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when Retry-After exceeds maxRetryAfterSeconds", async () => {
    const excessive = RETRY_CONFIG.maxRetryAfterSeconds + 1;
    fetchMock.mockResolvedValue(responseWithRetryAfter(String(excessive)));

    // The oversized-Retry-After branch throws before sleeping, and the
    // resulting Error doesn't match any retryable pattern, so the loop
    // breaks out without consuming the remaining attempts.
    await expect(fetchWithRetry("https://example.com", {})).rejects.toThrow(
      new RegExp(
        `Retry-After of ${excessive}s.*exceeds the maximum of ${RETRY_CONFIG.maxRetryAfterSeconds}s`,
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to exponential backoff when Retry-After is missing on 429", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const promise = fetchWithRetry("https://example.com", {});
    // calculateDelay(0) === RETRY_CONFIG.baseDelayMs
    await vi.advanceTimersByTimeAsync(RETRY_CONFIG.baseDelayMs - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores Retry-After on non-429 retryable responses (e.g. 503)", async () => {
    const longRetryAfter = String(RETRY_CONFIG.maxRetryAfterSeconds + 600);
    fetchMock
      .mockResolvedValueOnce(responseWithRetryAfter(longRetryAfter, 503))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const promise = fetchWithRetry("https://example.com", {});
    // Exponential backoff applies, not the header value — otherwise this
    // would wait 10 minutes and the test would time out.
    await vi.advanceTimersByTimeAsync(RETRY_CONFIG.baseDelayMs);
    const response = await promise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
