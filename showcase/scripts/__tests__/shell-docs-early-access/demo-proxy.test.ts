// The docs' channel demo booking proxy (shell-docs
// src/lib/early-access/demo-proxy.ts): input validation, the reader key its
// rate limits count under, and how it maps the website's answers. The
// website is a mocked fetch: nothing here reaches copilotkit.ai or Calendly.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type * as ProxyModule from "../../../shell-docs/src/lib/early-access/demo-proxy";

/** A fresh module, so each test starts with empty rate limits. */
async function loadProxy(): Promise<typeof ProxyModule> {
  vi.resetModules();
  return import("../../../shell-docs/src/lib/early-access/demo-proxy");
}

let lastOctet = 0;
/** A reader address no other request in the file uses. */
const readerIp = () => `198.51.100.${(lastOctet++ % 250) + 1}`;

const VALID = {
  channel: "whatsapp",
  startTime: "2026-12-02T17:00:00Z",
  name: "Jane Doe",
  email: "jane@acme.dev",
  company: "Acme",
  timeZone: "America/New_York",
};

function bookRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("https://docs.test/api/channel-demo/book", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": readerIp(),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function slotsRequest(channel: string, headers: Record<string, string> = {}) {
  return new Request(
    `https://docs.test/api/channel-demo/slots?channel=${channel}`,
    { headers: { "x-real-ip": readerIp(), ...headers } },
  );
}

/** Mocks the website's answer to every fetch, and records the requests. */
function website(answer: (url: string) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: URL | string, _init?: RequestInit) =>
    answer(String(url)),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const BOOKED = {
  ok: true,
  booking: {
    startTime: VALID.startTime,
    rescheduleUrl: "https://calendly.com/reschedulings/abc",
    cancelUrl: "https://calendly.com/cancellations/abc",
    hosts: ["Ada"],
  },
};

beforeEach(() => {
  vi.stubEnv("CHANNEL_DEMO_FIXTURE", "");
  vi.stubEnv("COPILOTKIT_WEBSITE_URL", "https://website.test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("input validation", () => {
  test("refuses each malformed field by name, and never calls the website", async () => {
    const { bookChannelDemo } = await loadProxy();
    const fetchMock = website(() => json(200, BOOKED));
    const cases: [Record<string, unknown>, string | undefined][] = [
      [{ name: "" }, "name"],
      [{ name: "x".repeat(101) }, "name"],
      [{ email: "not-an-email" }, "email"],
      [{ email: `${"a".repeat(250)}@acme.dev` }, "email"],
      [{ company: "  " }, "company"],
      [{ building: "x".repeat(2000) }, "building"],
      [{ timeZone: "Mars/Base" }, "timeZone"],
      [{ channel: "telegram" }, undefined],
    ];
    for (const [change, field] of cases) {
      const response = await bookChannelDemo(
        bookRequest({ ...VALID, ...change }),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        ok: false,
        code: "invalid_input",
        ...(field ? { field } : {}),
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a start time must be the website's own UTC form and a real date", async () => {
    const { bookChannelDemo } = await loadProxy();
    website(() => json(200, BOOKED));
    for (const startTime of [
      "2026-02-30T17:00:00Z", // no such day
      "2026-12-02T17:00:00+01:00",
      "2026-12-02T17:00Z",
      "2026-12-02T17:00:00.1234567890Z", // ten fraction digits
      "2026-12-02",
    ]) {
      const response = await bookChannelDemo(
        bookRequest({ ...VALID, startTime }),
      );
      expect(response.status, startTime).toBe(400);
    }
    for (const startTime of [
      "2026-12-02T17:00:00Z",
      "2026-12-02T17:00:00.123456789Z",
    ]) {
      const response = await bookChannelDemo(
        bookRequest({ ...VALID, startTime }),
      );
      expect(response.status, startTime).toBe(200);
    }
  });

  test("an over-long email never reaches the email pattern (no regex backtracking)", async () => {
    const { bookChannelDemo } = await loadProxy();
    // The pattern the freshly loaded proxy uses.
    const { EMAIL_PATTERN } =
      await import("../../../shell-docs/src/lib/early-access/booking");
    website(() => json(200, BOOKED));
    const patternTest = vi.spyOn(EMAIL_PATTERN, "test");
    const email = `a@${"a.".repeat(8100)}@`;
    const response = await bookChannelDemo(bookRequest({ ...VALID, email }));
    expect(response.status).toBe(400);
    expect(patternTest).not.toHaveBeenCalled();
  });

  test("a body over 16 KB is refused without parsing it", async () => {
    const { bookChannelDemo } = await loadProxy();
    const fetchMock = website(() => json(200, BOOKED));
    // Under 16K characters, over 16 KB: every é is two bytes.
    const body = JSON.stringify({ ...VALID, building: "é".repeat(9000) });
    expect(body.length).toBeLessThan(16_384);
    const response = await bookChannelDemo(bookRequest(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a filled honeypot gets the generic refusal before any field is checked", async () => {
    const { bookChannelDemo } = await loadProxy();
    const fetchMock = website(() => json(200, BOOKED));
    const response = await bookChannelDemo(
      bookRequest({ ...VALID, name: "", kt_hp: "https://spam.example" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, code: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("requests that fail validation are throttled too", async () => {
    const { bookChannelDemo } = await loadProxy();
    website(() => json(200, BOOKED));
    const ip = readerIp();
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) {
      const response = await bookChannelDemo(
        bookRequest({ ...VALID, name: "" }, { "x-real-ip": ip }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(30).every((s) => s === 429)).toBe(true);
  });
});

const headers = (h: Record<string, string>) => new Headers(h);

describe("reader key", () => {
  test("never reads x-forwarded-for", async () => {
    const { clientKey } = await loadProxy();
    const spoofed = headers({
      "x-real-ip": "203.0.113.7",
      "x-forwarded-for": "1.2.3.4, 203.0.113.7",
    });
    expect(clientKey(spoofed)).toBe("203.0.113.7");
    expect(clientKey(headers({ "x-forwarded-for": "1.2.3.4" }))).toBe(
      clientKey(headers({})),
    );
  });

  test("believes cf-connecting-ip only from a Cloudflare peer", async () => {
    const { clientKey } = await loadProxy();
    // A client that reaches the origin directly and claims to be someone else.
    expect(
      clientKey(
        headers({ "x-real-ip": "203.0.113.7", "cf-connecting-ip": "1.2.3.4" }),
      ),
    ).toBe("203.0.113.7");
    // Through Cloudflare (IPv4 and IPv6 edges): the reader Cloudflare names.
    expect(
      clientKey(
        headers({
          "x-real-ip": "162.158.10.20",
          "cf-connecting-ip": "1.2.3.4",
        }),
      ),
    ).toBe("1.2.3.4");
    expect(
      clientKey(
        headers({
          "x-real-ip": "2606:4700::6810:1",
          "cf-connecting-ip": "1.2.3.4",
        }),
      ),
    ).toBe("1.2.3.4");
    expect(
      clientKey(
        headers({
          "x-real-ip": "::ffff:104.16.0.1",
          "cf-connecting-ip": "1.2.3.4",
        }),
      ),
    ).toBe("1.2.3.4");
  });

  test("checks Cloudflare's published ranges", async () => {
    const { isCloudflareIp } = await loadProxy();
    expect(isCloudflareIp("173.245.48.1")).toBe(true);
    expect(isCloudflareIp("172.71.255.255")).toBe(true); // 172.64.0.0/13
    expect(isCloudflareIp("172.72.0.0")).toBe(false);
    expect(isCloudflareIp("2a06:98c7:ffff::1")).toBe(true); // 2a06:98c0::/29
    expect(isCloudflareIp("2a06:98c8::1")).toBe(false);
    expect(isCloudflareIp("203.0.113.7")).toBe(false);
  });

  test("counts an IPv6 reader by its /64", async () => {
    const { clientKey } = await loadProxy();
    const a = clientKey(headers({ "x-real-ip": "2001:db8:1:2:aaaa::1" }));
    const b = clientKey(
      headers({ "x-real-ip": "2001:0db8:0001:0002:ffff:ffff:ffff:ffff" }),
    );
    const c = clientKey(headers({ "x-real-ip": "2001:db8:1:3::1" }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test("anything that isn't an address counts under one shared key", async () => {
    const { clientKey } = await loadProxy();
    const shared = clientKey(headers({}));
    expect(clientKey(headers({ "x-real-ip": "not an ip" }))).toBe(shared);
    expect(clientKey(headers({ "x-real-ip": "1".repeat(5000) }))).toBe(shared);
    expect(
      clientKey(
        headers({ "x-real-ip": "162.158.10.20", "cf-connecting-ip": "evil" }),
      ),
    ).not.toBe("evil");
  });
});

describe("booking through the website", () => {
  test("forwards the channel's event, ref and answer line, for work email only", async () => {
    const { bookChannelDemo } = await loadProxy();
    const fetchMock = website(() => json(200, BOOKED));
    const response = await bookChannelDemo(
      bookRequest({
        ...VALID,
        channel: "imessage",
        building: "Order questions",
      }),
    );
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://website.test/api/talk-to-engineer/book");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      // Every channel books the website's "Talk to an Engineer" event for
      // now; the channel rides in the answer line and the ref.
      event: "talk_to_engineer",
      ref: "docs_imessage_early_access",
      workEmailOnly: true,
      kt_hp: "",
      building: "Channel: iMessage (early access)\n\nOrder questions",
    });
  });

  test.each([
    [409, { ok: false, code: "slot_taken" }, 409, "slot_taken"],
    [429, "Too Many Requests", 429, "rate_limited"],
    [503, { ok: false, code: "provider_unavailable" }, 503, "unavailable"],
    [404, "not found", 503, "unavailable"],
    [500, { ok: false, code: "unknown" }, 502, "unconfirmed"],
    [502, { ok: false, code: "unknown" }, 502, "unconfirmed"],
  ] as const)(
    "maps a website %i to %i %s",
    async (websiteStatus, body, status, code) => {
      const { bookChannelDemo } = await loadProxy();
      website(() =>
        typeof body === "string"
          ? new Response(body, { status: websiteStatus })
          : json(websiteStatus, body),
      );
      const response = await bookChannelDemo(bookRequest(VALID));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, code });
    },
  );

  test("passes a work email refusal and a known field through", async () => {
    const { bookChannelDemo } = await loadProxy();
    website(() =>
      json(400, {
        ok: false,
        code: "invalid_input",
        field: "email",
        reason: "work_email_required",
      }),
    );
    expect(await (await bookChannelDemo(bookRequest(VALID))).json()).toEqual({
      ok: false,
      code: "invalid_input",
      field: "email",
      reason: "work_email_required",
    });
    website(() =>
      json(400, { ok: false, code: "invalid_input", field: "jobTitle" }),
    );
    expect(await (await bookChannelDemo(bookRequest(VALID))).json()).toEqual({
      ok: false,
      code: "invalid_input",
    });
  });

  test("a booking without https links reads as unconfirmed", async () => {
    const { bookChannelDemo } = await loadProxy();
    website(() =>
      json(200, {
        ...BOOKED,
        booking: { ...BOOKED.booking, rescheduleUrl: "javascript:alert(1)" },
      }),
    );
    const response = await bookChannelDemo(bookRequest(VALID));
    expect(response.status).toBe(502);
  });

  test("a connection that never opened is unavailable, a timeout unconfirmed", async () => {
    const { bookChannelDemo } = await loadProxy();
    for (const code of [
      "ENOTFOUND",
      "ECONNREFUSED",
      "EAI_AGAIN",
      "UND_ERR_CONNECT_TIMEOUT",
    ]) {
      website(() => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error(code), { code }),
        });
      });
      const response = await bookChannelDemo(bookRequest(VALID));
      expect(response.status, code).toBe(503);
      expect(await response.json()).toEqual({ ok: false, code: "unavailable" });
    }
    website(() => {
      throw new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      );
    });
    const response = await bookChannelDemo(bookRequest(VALID));
    expect(response.status).toBe(502);
  });

  test("a website URL that isn't https books nothing and says so", async () => {
    for (const url of ["http://website.test", "not a url"]) {
      vi.stubEnv("COPILOTKIT_WEBSITE_URL", url);
      const { bookChannelDemo } = await loadProxy();
      const fetchMock = website(() => json(200, BOOKED));
      const response = await bookChannelDemo(bookRequest(VALID));
      expect(response.status, url).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  test("caps bookings across all readers at five a minute", async () => {
    const { bookChannelDemo } = await loadProxy();
    const fetchMock = website(() => json(200, BOOKED));
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await bookChannelDemo(bookRequest(VALID))).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  test("a reader over their own limit doesn't use up everyone's", async () => {
    const { bookChannelDemo } = await loadProxy();
    website(() => json(409, { ok: false, code: "slot_taken" }));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const start = Date.now();
      const ip = readerIp();
      for (let i = 0; i < 5; i++) {
        await bookChannelDemo(bookRequest(VALID, { "x-real-ip": ip }));
      }
      // A minute on, the shared window is clear; this reader's own isn't.
      vi.setSystemTime(start + 61_000);
      const own: number[] = [];
      for (let i = 0; i < 3; i++) {
        own.push(
          (await bookChannelDemo(bookRequest(VALID, { "x-real-ip": ip })))
            .status,
        );
      }
      expect(own).toEqual([429, 429, 429]);
      // Their refused tries took none of the five shared slots.
      const others: number[] = [];
      for (let i = 0; i < 5; i++) {
        others.push((await bookChannelDemo(bookRequest(VALID))).status);
      }
      expect(others).toEqual([409, 409, 409, 409, 409]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("open times", () => {
  test("tells no open times apart from a failed read", async () => {
    const { getChannelDemoTimes } = await loadProxy();
    website(() => json(200, { ok: true, slots: [], unavailable: [] }));
    expect(
      await (await getChannelDemoTimes(slotsRequest("sms"))).json(),
    ).toEqual({
      status: "unavailable",
      reason: "none",
      slots: [],
      unavailable: [],
    });
    website(() => json(503, { ok: false, reason: "slots_error" }));
    expect(
      await (await getChannelDemoTimes(slotsRequest("sms"))).json(),
    ).toEqual({
      status: "unavailable",
      reason: "error",
      slots: [],
      unavailable: [],
    });
  });

  test("keeps only the start times, and lets go of a failed answer's body", async () => {
    const { getChannelDemoTimes } = await loadProxy();
    website(() =>
      json(200, {
        ok: true,
        slots: [
          {
            startTime: "2026-12-02T17:00:00Z",
            startMs: 1,
            schedulingUrl: "https://calendly.com/x",
          },
        ],
      }),
    );
    expect(
      await (await getChannelDemoTimes(slotsRequest("rcs"))).json(),
    ).toEqual({
      status: "live",
      slots: [{ startTime: "2026-12-02T17:00:00Z" }],
      unavailable: [],
    });
    const cancel = vi.fn();
    website(
      () =>
        new Response(new ReadableStream({ start() {}, cancel }), {
          status: 400,
        }),
    );
    await getChannelDemoTimes(slotsRequest("rcs"));
    expect(cancel).toHaveBeenCalled();
  });

  test("gives each reader sixty reads a minute", async () => {
    const { getChannelDemoTimes } = await loadProxy();
    website(() => json(200, { ok: true, slots: [], unavailable: [] }));
    const ip = readerIp();
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const response = await getChannelDemoTimes(
        slotsRequest("sms", { "x-real-ip": ip }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 60).filter((s) => s !== 200)).toEqual([]);
    expect(statuses[60]).toBe(429);
    // Another reader keeps their own.
    expect((await getChannelDemoTimes(slotsRequest("sms"))).status).toBe(200);
  });
});

describe("readers without a readable address", () => {
  // Railway's edge doesn't set x-real-ip on every connection, and a
  // Cloudflare edge may not name the reader. Such readers can't be told
  // apart, so none of them has limits of their own.
  const NO_ADDRESS_LINE =
    "[channel-demo] no readable client address; per-reader limits skipped";
  const CLOUDFLARE_EDGE = "162.158.10.20";
  const NO_TIMES = { ok: true, slots: [], unavailable: [] };

  let turn = 0;
  /**
   * `request` from a reader whose address can't be read: by turns, with no
   * x-real-ip, and through a Cloudflare edge that doesn't name the reader.
   */
  function fromUnknownReader(request: Request) {
    if (turn++ % 2 === 0) request.headers.delete("x-real-ip");
    else request.headers.set("x-real-ip", CLOUDFLARE_EDGE);
    return request;
  }

  test("aren't held to one reader's limit on booking requests", async () => {
    const { bookChannelDemo } = await loadProxy();
    website(() => json(200, BOOKED));
    // Past one reader's 30 a minute. These fail validation: nothing books.
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) {
      const response = await bookChannelDemo(
        fromUnknownReader(bookRequest({ ...VALID, name: "" })),
      );
      statuses.push(response.status);
    }
    expect(statuses.filter((s) => s !== 400)).toEqual([]);
  });

  test("aren't held to one reader's five bookings in ten minutes", async () => {
    const { bookChannelDemo } = await loadProxy();
    const fetchMock = website(() => json(200, BOOKED));
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const start = Date.now();
      // Five a minute, the limit across all readers, for three minutes.
      const statuses: number[] = [];
      for (let minute = 0; minute < 3; minute++) {
        vi.setSystemTime(start + minute * 61_000);
        for (let i = 0; i < 5; i++) {
          const response = await bookChannelDemo(
            fromUnknownReader(bookRequest(VALID)),
          );
          statuses.push(response.status);
        }
      }
      expect(statuses.filter((s) => s !== 200)).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(15);
    } finally {
      vi.useRealTimers();
    }
  });

  test("still book at most five a minute, the limit across all readers", async () => {
    const { bookChannelDemo } = await loadProxy();
    const fetchMock = website(() => json(200, BOOKED));
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const response = await bookChannelDemo(
        fromUnknownReader(bookRequest(VALID)),
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  test("share one cap of 600 reads of the times a minute", async () => {
    const { getChannelDemoTimes } = await loadProxy();
    website(() => json(200, NO_TIMES));
    const statuses: number[] = [];
    for (let i = 0; i < 600; i++) {
      const response = await getChannelDemoTimes(
        fromUnknownReader(slotsRequest("sms")),
      );
      statuses.push(response.status);
    }
    expect(statuses.filter((s) => s !== 200)).toEqual([]);
    const capped = await getChannelDemoTimes(
      fromUnknownReader(slotsRequest("sms")),
    );
    expect(capped.status).toBe(429);
    expect(Number(capped.headers.get("Retry-After"))).toBeGreaterThan(0);
    // A reader with an address doesn't count toward it.
    expect((await getChannelDemoTimes(slotsRequest("sms"))).status).toBe(200);
  });

  test("are logged once, in a line without any address", async () => {
    const { bookChannelDemo, getChannelDemoTimes } = await loadProxy();
    website((url) => json(200, url.endsWith("/book") ? BOOKED : NO_TIMES));
    await getChannelDemoTimes(slotsRequest("sms"));
    await bookChannelDemo(bookRequest(VALID));
    expect(console.warn).not.toHaveBeenCalledWith(NO_ADDRESS_LINE);
    for (let i = 0; i < 2; i++) {
      await getChannelDemoTimes(fromUnknownReader(slotsRequest("sms")));
      await bookChannelDemo(fromUnknownReader(bookRequest(VALID)));
    }
    const lines = vi
      .mocked(console.warn)
      .mock.calls.filter(([line]) => line === NO_ADDRESS_LINE);
    expect(lines).toEqual([[NO_ADDRESS_LINE]]);
  });
});
