import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ClickCapture from "../clicks";
import type * as InputCapture from "../inputs";
import {
  createTrajectoryCollector,
  MAX_TRAJECTORY_EVENT_BYTES,
} from "../trajectory-collector";
import type {
  JsonValue,
  TrajectoryCaptureOptions,
  TrajectoryCollector,
  TrajectoryEvent,
} from "../trajectory-types";

// jsdom cannot produce trusted clicks. The capture module itself remains real.
vi.mock("../clicks", async (importOriginal) => {
  const actual = await importOriginal<typeof ClickCapture>();
  return {
    ...actual,
    installClickCapture: (
      params: Parameters<typeof actual.installClickCapture>[0],
    ) => actual.installClickCapture({ ...params, isTrusted: () => true }),
  };
});

vi.mock("../inputs", async (importOriginal) => {
  const actual = await importOriginal<typeof InputCapture>();
  return {
    ...actual,
    installInputCapture: (
      params: Parameters<typeof actual.installInputCapture>[0],
    ) => actual.installInputCapture({ ...params, isTrusted: () => true }),
  };
});

const NOW = 1_790_866_801_000;
const collectors: TrajectoryCollector[] = [];

function setup(options: TrajectoryCaptureOptions = {}) {
  const send = vi.fn<(event: TrajectoryEvent) => void>();
  const onError = vi.fn();
  const collector = createTrajectoryCollector({
    routes: ["/deals", "/deals/:id"],
    send,
    onError,
    ...options,
  });
  collectors.push(collector);
  return { collector, send, onError };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  history.replaceState(null, "", "/deals?email=secret@example.com#private");
  document.body.innerHTML =
    '<div data-message-id="private-message"><button data-copilotkit-action="deal.open">Private deal text</button></div>';
});

afterEach(() => {
  collectors.splice(0).forEach((collector) => collector.stop());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("Trajectory capture contract", () => {
  it("sends real page, click, and navigation capture as plain events without chat context", () => {
    const fetchBefore = globalThis.fetch;
    const xhrBefore = XMLHttpRequest.prototype.open;
    const { collector, send } = setup();
    collector.start();
    document.querySelector("button")!.click();
    history.pushState(null, "", "/deals/42?token=private#secret");

    expect(send.mock.calls.map(([event]) => event)).toMatchObject([
      {
        type: "CUSTOM",
        name: "page",
        timestamp: NOW,
        value: {
          route: "/deals",
          url: `${location.origin}/deals?email=secret@example.com#private`,
          title: document.title,
          referrer: document.referrer,
        },
      },
      {
        type: "CUSTOM",
        name: "click",
        timestamp: NOW,
        value: {
          route: "/deals",
          target: {
            tag: "button",
            role: null,
            action: "deal.open",
            text: "Private deal text",
            attributes: { "data-copilotkit-action": "deal.open" },
          },
        },
      },
      {
        type: "CUSTOM",
        name: "navigation",
        timestamp: NOW,
        value: {
          from: `${location.origin}/deals?email=secret@example.com#private`,
          to: `${location.origin}/deals/42?token=[redacted]#secret`,
          navigationType: "push",
        },
      },
    ]);
    expect(JSON.stringify(send.mock.calls)).not.toMatch(
      /threadId|"seq"|trajectoryId|learningContainerIds/,
    );
    expect(globalThis.fetch).not.toBe(fetchBefore);
    expect(XMLHttpRequest.prototype.open).not.toBe(xhrBefore);
    collector.stop();
    expect(globalThis.fetch).toBe(fetchBefore);
    expect(XMLHttpRequest.prototype.open).toBe(xhrBefore);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains unconfigured paths and user edits without Thread enrichment", () => {
    const { collector, send } = setup({ routes: [] });
    collector.start();
    history.pushState(
      null,
      "",
      "/users/alice/private-email@example.com?view=full#profile",
    );
    document.body.innerHTML =
      '<input id="email" type="email" data-message-id="message-1">';
    const input = document.querySelector("input")!;
    input.value = "synthetic@example.com";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(send.mock.calls[0]?.[0].value).toMatchObject({
      route: "/deals",
      url: expect.stringContaining("?email="),
    });
    expect(send.mock.calls[1]?.[0].value).toMatchObject({
      to: `${location.origin}/users/alice/private-email@example.com?view=full#profile`,
    });
    expect(send.mock.calls[2]?.[0]).toMatchObject({
      name: "input",
      value: {
        eventType: "input",
        target: {
          value: "synthetic@example.com",
          attributes: { "data-message-id": "message-1" },
        },
      },
    });
    expect(send.mock.calls[2]?.[0].value).not.toHaveProperty("threadId");
    expect(send.mock.calls[2]?.[0].value).not.toHaveProperty("messageId");
  });

  it("sends raw network bodies and excludes its configured transport URL", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      Response.json(
        { result: "synthetic-response" },
        { headers: { "x-capture": "full" } },
      ),
    );
    const { collector, send } = setup({ ignoreUrls: ["/capture-ingest"] });
    try {
      collector.start();
      const response = await fetch("/api/deals?key=synthetic#full", {
        method: "POST",
        headers: { "x-test": "synthetic-header" },
        body: "synthetic-request",
      });
      expect(await response.json()).toEqual({ result: "synthetic-response" });
      await fetch("/capture-ingest", { method: "POST", body: "ignore-self" });
      await vi.advanceTimersByTimeAsync(0);
      const events = send.mock.calls
        .map(([event]) => event)
        .filter((event) => event.name === "network");
      expect(events).toHaveLength(1);
      expect(events[0]?.value).toMatchObject({
        url: `${location.origin}/api/deals?key=synthetic#full`,
        request: {
          headers: { "x-test": "synthetic-header" },
          body: { status: "complete", text: "synthetic-request" },
        },
        response: {
          headers: { "x-capture": "full" },
          body: { status: "complete", text: '{"result":"synthetic-response"}' },
        },
      });
    } finally {
      collector.stop();
      globalThis.fetch = originalFetch;
    }
  });

  it("honors ignored DOM subtrees without reading their content", () => {
    document.body.innerHTML =
      '<section data-copilotkit-ignore><button data-copilotkit-action="secret">Private</button></section>';
    const { collector, send } = setup();
    collector.start();
    document.querySelector("button")!.click();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("supports capture switches while retaining initial page context", () => {
    const { collector, send } = setup({
      capture: {
        clicks: false,
        navigation: false,
        inputs: false,
        network: false,
      },
    });
    collector.start();
    document.querySelector("button")!.click();
    history.pushState(null, "", "/deals/42");
    expect(send.mock.calls.map(([event]) => event.name)).toEqual(["page"]);
  });

  it("starts once and removes capture on stop without buffering events", async () => {
    const pushBefore = History.prototype.pushState;
    const { collector, send } = setup();
    collector.emit("app.before", true);
    collector.start();
    collector.start();
    collector.stop();
    document.querySelector("button")!.click();
    history.pushState(null, "", "/deals/42");
    collector.emit("app.after", true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(History.prototype.pushState).toBe(pushBefore);
    expect(vi.getTimerCount()).toBe(0);
    collector.start();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each<JsonValue>([
    null,
    true,
    42,
    "done",
    [1, "yes", null],
    { nested: { outcome: "approved" } },
  ])("preserves developer JSON values: %j", (value) => {
    const { collector, send } = setup();
    collector.start();
    collector.emit("deal.approved", value);
    expect(send.mock.calls[1]?.[0]).toEqual({
      type: "CUSTOM",
      name: "deal.approved",
      timestamp: NOW,
      value,
    });
  });

  it("snapshots developer objects and allows shared non-cyclic values", () => {
    const { collector, send } = setup();
    const shared = { status: "approved" };
    const value = { first: shared, second: shared };
    collector.start();
    collector.emit("deal.approved", value);
    shared.status = "changed";
    expect(send.mock.calls[1]?.[0].value).toEqual({
      first: { status: "approved" },
      second: { status: "approved" },
    });
  });

  it("rejects non-JSON values, cycles, empty names, and reserved event names", () => {
    const { collector, send, onError } = setup();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    collector.start();
    for (const value of [
      undefined,
      NaN,
      Infinity,
      BigInt(1),
      new Date(),
      () => {},
      { absent: undefined },
      [undefined],
      cycle,
    ]) {
      collector.emit("invalid", value as JsonValue);
    }
    collector.emit("", null);
    collector.emit(" ", null);
    collector.emit("click", {});
    collector.emit("thread.linked", {});
    expect(send).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(13);
    expect(
      onError.mock.calls.every(([error]) => error.code === "INVALID_EVENT"),
    ).toBe(true);
  });

  it("enforces the 16 KiB UTF-8 limit, including the event envelope", () => {
    const { collector, send, onError } = setup();
    collector.start();
    const empty = {
      type: "CUSTOM",
      name: "app.value",
      timestamp: NOW,
      value: "",
    };
    const available =
      MAX_TRAJECTORY_EVENT_BYTES -
      new TextEncoder().encode(JSON.stringify(empty)).byteLength;
    collector.emit("app.value", "a".repeat(available));
    collector.emit("app.value", "a".repeat(available + 1));
    collector.emit("app.value", "😀".repeat(Math.floor(available / 2)));
    expect(send).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "EVENT_TOO_LARGE" }),
    );
  });

  it("rejects NUL characters and event names the Gateway cannot store", () => {
    const { collector, send, onError } = setup();
    collector.start();
    collector.emit("app.value", "null\0character");
    collector.emit("app.value", { "key\0name": "value" });
    collector.emit("app\0name", true);
    collector.emit("a".repeat(201), true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(4);
    expect(
      onError.mock.calls.every(([error]) => error.code === "INVALID_EVENT"),
    ).toBe(true);
  });

  it("runs filtering before final validation and sending", () => {
    const { collector, send, onError } = setup({
      beforeSend: (event) =>
        event.name === "page"
          ? null
          : { ...event, value: undefined as unknown as JsonValue },
    });
    collector.start();
    collector.emit("app.event", true);
    expect(send).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_EVENT" }),
    );
  });

  it("contains callback errors and does not retry failed sends", async () => {
    const { collector, send } = setup({
      onError: () => {
        throw new Error("diagnostic callback");
      },
    });
    send.mockImplementation(() => {
      throw new Error("failed send");
    });
    expect(() => collector.start()).not.toThrow();
    await vi.advanceTimersByTimeAsync(10_000);
    collector.stop();
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
