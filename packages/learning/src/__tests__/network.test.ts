import { afterEach, describe, expect, it, vi } from "vitest";
import { installNetworkCapture } from "../network";

interface Captured {
  name: string;
  value: Record<string, unknown>;
}

// jsdom pins the page origin, so relative URLs resolve against it.
const PAGE_ORIGIN = "http://localhost:3000";
const realFetch = globalThis.fetch;
let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  globalThis.fetch = realFetch;
});

function setup(fakeFetch: typeof fetch, ignoreUrls: (string | RegExp)[] = []) {
  globalThis.fetch = fakeFetch;
  const events: Captured[] = [];
  uninstall = installNetworkCapture({
    emit: (name, value) => events.push({ name, value }),
    routes: ["/api/deals/:id"],
    ignoreUrls,
  });
  return events;
}

function respondWith(status: number) {
  return vi.fn<typeof fetch>(
    async () => new Response("data: 1\n\n", { status }),
  );
}

function withoutDuration(events: Captured[]) {
  return events.map(({ name, value }) => {
    const { durationMs, ...rest } = value;
    expect(typeof durationMs).toBe("number");
    return { name, value: rest };
  });
}

describe("fetch capture", () => {
  it("records metadata and returns the untouched streaming response", async () => {
    const events = setup(respondWith(201));

    const response = await fetch("/api/deals/42?token=secret");
    await Promise.resolve();

    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toBe("data: 1\n\n");
    expect(withoutDuration(events)).toEqual([
      {
        name: "network",
        value: {
          transport: "fetch",
          method: "GET",
          origin: PAGE_ORIGIN,
          route: "/api/deals/:id",
          status: 201,
          outcome: "ok",
        },
      },
    ]);
  });

  it("reads the method from a Request and from init", async () => {
    const events = setup(respondWith(200));

    await fetch(
      new Request("https://api.example.com/orders/9", { method: "post" }),
    );
    await fetch(new URL("https://api.example.com/orders"), {
      method: "delete",
    });
    await Promise.resolve();

    expect(
      events.map((event) => [event.value.method, event.value.route]),
    ).toEqual([
      ["POST", "/orders/:id"],
      ["DELETE", "/orders"],
    ]);
  });

  it("skips ignored URLs, including relative prefixes", async () => {
    const events = setup(respondWith(200), [
      "/api/learning-events",
      /copilotkit/,
    ]);

    await fetch("/api/learning-events");
    await fetch("https://runtime.example.com/api/copilotkit/run");
    await Promise.resolve();

    expect(events).toEqual([]);
  });

  it("marks Next.js framework requests without reading header values", async () => {
    const events = setup(respondWith(200));

    await fetch("/learning/deals/1?_rsc=abc");
    await fetch("/learning", {
      headers: { RSC: "1", "Next-Router-Prefetch": "1" },
    });
    await fetch("/learning", {
      method: "POST",
      headers: { "Next-Action": "a1b2" },
    });
    await fetch("/api/deals/1");
    await Promise.resolve();

    expect(events.map((event) => event.value.framework)).toEqual([
      "next-rsc",
      "next-prefetch",
      "next-action",
      undefined,
    ]);
  });

  it("reports aborted and failed requests and rethrows the same error", async () => {
    const abort = new DOMException("stopped", "AbortError");
    const offline = new TypeError("Failed to fetch");
    const events = setup(
      vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(abort)
        .mockRejectedValueOnce(offline),
    );

    await expect(fetch("/a")).rejects.toBe(abort);
    await expect(fetch("/b")).rejects.toBe(offline);

    expect(
      events.map((event) => [event.value.outcome, event.value.status]),
    ).toEqual([
      ["aborted", null],
      ["error", null],
    ]);
  });

  it("keeps a later wrapper working after stop and passes through", async () => {
    const fake = respondWith(200);
    const events = setup(fake);
    const ours = globalThis.fetch;
    const thirdParty = vi.fn<typeof fetch>((input, init) => ours(input, init));
    globalThis.fetch = thirdParty;

    uninstall?.();
    uninstall = undefined;
    await fetch("/after-stop");

    expect(globalThis.fetch).toBe(thirdParty);
    expect(fake).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
  });
});

describe("XMLHttpRequest capture", () => {
  it("records method, status, and route on loadend", async () => {
    const events = setup(respondWith(200));
    const xhr = new XMLHttpRequest();
    const done = new Promise((resolve) =>
      xhr.addEventListener("loadend", resolve),
    );

    xhr.open("get", "data:text/plain,hello");
    xhr.send();
    await done;

    expect(events).toHaveLength(1);
    expect(events[0]?.value).toMatchObject({
      transport: "xhr",
      method: "GET",
      status: 200,
      outcome: "ok",
    });
  });
});
