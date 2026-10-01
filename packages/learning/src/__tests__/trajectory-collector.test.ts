import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ClickCapture from "../clicks";
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

    expect(send.mock.calls.map(([event]) => event)).toEqual([
      {
        type: "CUSTOM",
        name: "page",
        timestamp: NOW,
        value: { route: "/deals" },
      },
      {
        type: "CUSTOM",
        name: "click",
        timestamp: NOW,
        value: {
          route: "/deals",
          target: { tag: "button", role: null, action: "deal.open" },
        },
      },
      {
        type: "CUSTOM",
        name: "navigation",
        timestamp: NOW,
        value: { from: "/deals", to: "/deals/:id" },
      },
    ]);
    expect(JSON.stringify(send.mock.calls)).not.toMatch(
      /secret|private|Private|threadId|seq|input|trajectoryId|learningContainerIds/,
    );
    expect(globalThis.fetch).toBe(fetchBefore);
    expect(XMLHttpRequest.prototype.open).toBe(xhrBefore);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses null for unconfigured routes instead of sending arbitrary path segments", () => {
    const { collector, send } = setup();
    collector.start();
    history.pushState(null, "", "/users/alice/private-email@example.com");
    document.querySelector("button")!.click();
    expect(send.mock.calls[1]?.[0].value).toEqual({ from: "/deals", to: null });
    expect(send.mock.calls[2]?.[0].value).toEqual({
      route: null,
      target: { tag: "button", role: null, action: "deal.open" },
    });
    expect(JSON.stringify(send.mock.calls)).not.toMatch(/alice|private-email/);
  });

  it("captures page context as null when no route templates are configured", () => {
    const { collector, send } = setup({ routes: [] });
    collector.start();
    expect(send.mock.calls[0]?.[0].value).toEqual({ route: null });
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
      capture: { clicks: false, navigation: false },
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

  it("enforces the 64 KiB UTF-8 limit, including the event envelope", () => {
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
