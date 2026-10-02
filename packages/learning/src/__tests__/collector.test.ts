import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCollector } from "../collector";
import type { CollectorOptions, LearningBatch, LearningSink } from "../types";

const NOW = 1_790_000_000_000;
const realFetch = globalThis.fetch;
const fakeFetch = vi.fn<typeof fetch>(
  async () => new Response(null, { status: 204 }),
);
let stopCurrent: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  globalThis.fetch = fakeFetch;
  history.replaceState(null, "", "/learning");
});

afterEach(() => {
  stopCurrent?.();
  stopCurrent = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

function setup(overrides: Partial<CollectorOptions> = {}) {
  const batches: LearningBatch[] = [];
  const sink: LearningSink = (batch) => {
    batches.push(batch);
  };
  const collector = createCollector({
    sink,
    routes: ["/learning/deals/:id"],
    ...overrides,
  });
  stopCurrent = () => collector.stop();
  return { collector, batches };
}

function names(batches: LearningBatch[]) {
  return batches.flatMap((batch) => batch.events.map((event) => event.name));
}

describe("createCollector", () => {
  it("installs nothing before start", () => {
    const { batches } = setup();

    history.pushState(null, "", "/learning/deals/1");
    vi.advanceTimersByTime(5000);

    expect(globalThis.fetch).toBe(fakeFetch);
    expect(batches).toEqual([]);
  });

  it("sends a page event, then batches every 2 seconds", () => {
    const { collector, batches } = setup();

    collector.start({ trajectoryId: "traj-1", learningContainerIds: ["c-1"] });
    history.pushState(null, "", "/learning/deals/1");
    vi.advanceTimersByTime(2000);

    expect(batches).toEqual([
      {
        trajectoryId: "traj-1",
        learningContainerIds: ["c-1"],
        dropped: 0,
        events: [
          {
            type: "CUSTOM",
            name: "page",
            timestamp: NOW,
            value: {
              route: "/learning",
              url: `${location.origin}/learning`,
              title: document.title,
              referrer: document.referrer,
              seq: 1,
            },
          },
          {
            type: "CUSTOM",
            name: "navigation",
            timestamp: NOW,
            value: {
              from: `${location.origin}/learning`,
              to: `${location.origin}/learning/deals/1`,
              navigationType: "push",
              seq: 2,
            },
          },
        ],
      },
    ]);
  });

  it("flushes as soon as 50 events are queued", () => {
    const { collector, batches } = setup();
    collector.start({ trajectoryId: "traj-1" });

    for (let index = 0; index < 49; index += 1)
      collector.emit("deal.viewed", { index });

    expect(batches).toHaveLength(1);
    expect(batches[0]?.events).toHaveLength(50);
  });

  it("ignores a second start with the same id and warns for another id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { collector, batches } = setup();

    collector.start({ trajectoryId: "traj-1" });
    collector.start({ trajectoryId: "traj-1" });
    collector.start({ trajectoryId: "traj-2" });
    vi.advanceTimersByTime(2000);

    expect(collector.trajectoryId).toBe("traj-1");
    expect(names(batches)).toEqual(["page"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("starts without the password watcher when the DOM is partial", () => {
    vi.spyOn(document, "querySelectorAll").mockImplementation(() => {
      throw new Error("no query support");
    });
    vi.stubGlobal(
      "MutationObserver",
      class {
        observe() {
          throw new Error("no observer support");
        }
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    const { collector } = setup();

    expect(() => collector.start({ trajectoryId: "traj-1" })).not.toThrow();
    expect(collector.trajectoryId).toBe("traj-1");
    expect(() => collector.stop()).not.toThrow();
  });

  it("installs hooks once across start, stop, start (StrictMode)", () => {
    const { collector, batches } = setup();

    collector.start({ trajectoryId: "traj-1" });
    collector.stop();
    collector.start({ trajectoryId: "traj-1" });
    history.pushState(null, "", "/learning/deals/9");
    vi.advanceTimersByTime(2000);

    expect(names(batches)).toEqual(["page", "page", "navigation"]);
    expect(
      batches.flatMap((batch) => batch.events.map((event) => event.value.seq)),
    ).toEqual([1, 2, 3]);
  });

  it("sends the final outcome once and removes capture hooks on stop", () => {
    const { collector, batches } = setup();
    collector.start({ trajectoryId: "traj-1" });
    collector.emit("deal.approved", { dealId: "deal-1" });

    collector.stop();
    collector.stop();
    collector.emit("deal.viewed", {});
    history.pushState(null, "", "/learning/deals/1");
    vi.advanceTimersByTime(5000);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.trajectoryId).toBe("traj-1");
    expect(names(batches)).toEqual(["page", "deal.approved"]);
    expect(batches[0]?.events[1]?.value).toEqual({ dealId: "deal-1", seq: 2 });
    expect(collector.trajectoryId).toBeNull();
    expect(globalThis.fetch).toBe(fakeFetch);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["throw", "reject"])(
    "does not retry or carry failed final events into the next trajectory (%s)",
    async (failure) => {
      const sink = vi.fn<LearningSink>(() => {
        if (failure === "throw") throw new Error("offline");
        return Promise.reject(new Error("offline"));
      });
      const { collector } = setup({ sink });
      collector.start({ trajectoryId: "traj-1" });
      collector.emit("deal.approved", {});

      expect(() => collector.stop()).not.toThrow();
      expect(collector.trajectoryId).toBeNull();
      sink.mockImplementation(() => {});
      collector.start({ trajectoryId: "traj-2" });
      await vi.advanceTimersByTimeAsync(5000);

      expect(sink).toHaveBeenCalledTimes(2);
      expect(sink.mock.calls[1]?.[0]).toMatchObject({
        trajectoryId: "traj-2",
        dropped: 0,
        events: [{ name: "page", value: { seq: 3 } }],
      });
    },
  );

  it("retains raw paths and full URLs in captured activity", async () => {
    history.replaceState(null, "", "/reset/eyJhbGc.eyJzdWIi.sig");
    const { collector, batches } = setup();
    collector.start({ trajectoryId: "traj-1" });
    history.pushState(null, "", "/users/jane@x.com?q=hello#details");
    await fetch("/search/private%20search");
    await vi.advanceTimersByTimeAsync(0);

    collector.stop();

    expect(batches[0]?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "page",
          value: expect.objectContaining({
            route: "/reset/eyJhbGc.eyJzdWIi.sig",
          }),
        }),
        expect.objectContaining({
          name: "navigation",
          value: expect.objectContaining({
            from: `${location.origin}/reset/eyJhbGc.eyJzdWIi.sig`,
            to: `${location.origin}/users/jane@x.com?q=hello#details`,
          }),
        }),
        expect.objectContaining({
          name: "network",
          value: expect.objectContaining({ route: "/search/private%20search" }),
        }),
      ]),
    );
  });

  it("lets beforeSend redact or drop events", () => {
    const { collector, batches } = setup({
      beforeSend: (event) =>
        event.name === "deal.secret"
          ? null
          : { ...event, value: { ...event.value, route: "redacted" } },
    });
    collector.start({ trajectoryId: "traj-1" });
    collector.emit("deal.secret", {});

    vi.advanceTimersByTime(2000);

    expect(
      batches[0]?.events.map((event) => [event.name, event.value.route]),
    ).toEqual([["page", "redacted"]]);
  });

  it("rejects built-in names from emit but accepts them from ɵemit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { collector, batches } = setup();
    collector.start({ trajectoryId: "traj-1" });

    collector.emit("click", { fake: true });
    collector.ɵemit("thread.linked", { threadId: "t-1" });
    vi.advanceTimersByTime(2000);

    expect(names(batches)).toEqual(["page", "thread.linked"]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("survives a failing sink and reports the loss in the next batch", async () => {
    const batches: LearningBatch[] = [];
    let calls = 0;
    const sink: LearningSink = async (batch) => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      batches.push(batch);
    };
    const { collector } = setup({ sink });
    collector.start({ trajectoryId: "traj-1" });
    collector.emit("deal.viewed", {});

    vi.advanceTimersByTime(2000);
    await vi.runOnlyPendingTimersAsync();

    expect(batches).toEqual([
      {
        trajectoryId: "traj-1",
        learningContainerIds: undefined,
        dropped: 2,
        events: [],
      },
    ]);
  });

  it("flushes with beacon on pagehide", () => {
    const sends: unknown[] = [];
    const sink: LearningSink = (_batch, options) => {
      sends.push(options);
    };
    const { collector } = setup({ sink });
    collector.start({ trajectoryId: "traj-1" });

    window.dispatchEvent(new Event("pagehide"));

    expect(sends).toEqual([{ beacon: true }]);
  });
});
