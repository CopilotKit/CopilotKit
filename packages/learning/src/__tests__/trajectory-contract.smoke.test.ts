import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ClickCapture from "../clicks";
import { createCollector } from "../collector";
import type { LearningEvent } from "../types";

// Synthetic contract spike, not the production Core/Runtime/Phoenix connection.
// Capture is real. Credentials, join, storage, acknowledgments, and lifecycle
// coordination below are mocks. jsdom clicks use the existing trust test seam.
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
const TRAJECTORY = "trajectory-smoke";
const routes = ["/deals", "/deals/:id"];
const grant = {
  joinToken: "mock-single-use-token",
  realtime: {
    clientUrl: "wss://gateway.invalid/socket",
    topic: `trajectory:${TRAJECTORY}`,
  },
};

type WireEvent = {
  type: "CUSTOM";
  name: string;
  timestamp: number;
  value: Record<string, unknown>;
};
type Receipt = { status: "persisted"; eventId: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function route(value: unknown) {
  return typeof value === "string" && routes.includes(value) ? value : null;
}

// Temporary adapter: the prototype emits batches, seq, input, and heuristic
// paths. Project only the fields in the draft contract. Production work remains.
function toWire(event: LearningEvent): WireEvent {
  const base = {
    type: event.type,
    name: event.name,
    timestamp: event.timestamp,
  };
  if (event.name === "page")
    return { ...base, value: { route: route(event.value.route) } };
  if (event.name === "navigation") {
    return {
      ...base,
      value: { from: route(event.value.from), to: route(event.value.to) },
    };
  }
  const target = event.value.target;
  if (
    event.name === "click" &&
    typeof target === "object" &&
    target !== null &&
    "tag" in target &&
    "role" in target &&
    "action" in target
  ) {
    return {
      ...base,
      value: {
        route: route(event.value.route),
        target: { tag: target.tag, role: target.role, action: target.action },
      },
    };
  }
  throw new Error(`Unexpected event in outside-chat spike: ${event.name}`);
}

const cleanups: (() => void)[] = [];

function harness(
  options: {
    credentials?: Promise<typeof grant>;
    joined?: Promise<void>;
    rejectPush?: boolean;
  } = {},
) {
  const records: { eventId: string; trajectoryId: string; event: WireEvent }[] =
    [];
  const receipts: Receipt[] = [];
  const failures: unknown[] = [];
  const runtime = vi.fn(
    async (_request: unknown) => options.credentials ?? grant,
  );
  const join = vi.fn(async (_credentials: typeof grant) => options.joined);
  const leave = vi.fn();
  const push = vi.fn(
    async (_name: "trajectory.event", event: WireEvent): Promise<Receipt> => {
      if (options.rejectPush) throw new Error("PERSISTENCE_FAILED");
      const eventId = `event-${records.length + 1}`;
      records.push({ eventId, trajectoryId: TRAJECTORY, event });
      return { status: "persisted", eventId };
    },
  );
  const collector = createCollector({
    routes,
    capture: { network: false },
    sink: async (batch) => {
      // Submit each event synchronously before awaiting any receipt. stop()
      // attempts its final batch once; this mock cannot prove delivery on close.
      await Promise.all(
        batch.events.map(async (event) => {
          try {
            receipts.push(await push("trajectory.event", toWire(event)));
          } catch (error) {
            failures.push(error);
            throw error;
          }
        }),
      );
    },
  });
  let generation = 0;
  let connected = false;
  const start = async () => {
    const attempt = ++generation;
    try {
      const credentials = await runtime({
        method: "trajectory/connect",
        params: { trajectoryId: TRAJECTORY },
        body: {},
      });
      if (attempt !== generation) return "cancelled";
      await join(credentials);
      if (attempt !== generation) {
        leave();
        return "cancelled";
      }
      connected = true;
      collector.start({ trajectoryId: TRAJECTORY });
      return "started";
    } catch (error) {
      failures.push(error);
      return "error";
    }
  };
  const stop = () => {
    generation += 1;
    collector.stop();
    if (connected) leave();
    connected = false;
  };
  cleanups.push(stop);
  return {
    start,
    stop,
    runtime,
    join,
    leave,
    push,
    records,
    receipts,
    failures,
    collector,
  };
}

function click() {
  document.querySelector("button")?.click();
}
const flush = () => vi.advanceTimersByTimeAsync(2000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  history.replaceState(null, "", "/deals?email=secret@example.com#private");
  document.body.innerHTML =
    '<button data-copilotkit-action="deal.open">Private deal text</button>';
});

afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("synthetic Trajectory contract (mock Runtime and Gateway)", () => {
  it("joins, captures a real page and click, and receives mock persisted receipts", async () => {
    const app = harness();
    expect(await app.start()).toBe("started");
    click();
    await flush();

    expect(app.runtime).toHaveBeenCalledWith({
      method: "trajectory/connect",
      params: { trajectoryId: TRAJECTORY },
      body: {},
    });
    expect(app.join).toHaveBeenCalledWith(grant);
    expect(app.push.mock.calls).toEqual([
      [
        "trajectory.event",
        {
          type: "CUSTOM",
          name: "page",
          timestamp: NOW,
          value: { route: "/deals" },
        },
      ],
      [
        "trajectory.event",
        {
          type: "CUSTOM",
          name: "click",
          timestamp: NOW,
          value: {
            route: "/deals",
            target: { tag: "button", role: null, action: "deal.open" },
          },
        },
      ],
    ]);
    expect(app.receipts).toEqual([
      { status: "persisted", eventId: "event-1" },
      { status: "persisted", eventId: "event-2" },
    ]);
    expect(app.records.map((record) => record.event)).toEqual(
      app.push.mock.calls.map((call) => call[1]),
    );
    expect(JSON.stringify(app.records)).not.toMatch(
      /secret|private|Private|threadId|seq|input/,
    );

    // Existing collector behavior: stop attempts queued events once.
    click();
    app.stop();
    expect(app.push).toHaveBeenCalledTimes(3);
    click();
    history.pushState(null, "", "/deals/42");
    await flush();
    expect(app.push).toHaveBeenCalledTimes(3);
    expect(app.leave).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("captures nothing until both credentials and join complete", async () => {
    const credentials = deferred<typeof grant>();
    const joined = deferred<void>();
    const app = harness({
      credentials: credentials.promise,
      joined: joined.promise,
    });
    const start = app.start();
    click();
    await flush();
    expect(app.collector.trajectoryId).toBeNull();
    expect(app.join).not.toHaveBeenCalled();
    credentials.resolve(grant);
    await flush();
    click();
    expect(app.join).toHaveBeenCalledTimes(1);
    expect(app.collector.trajectoryId).toBeNull();
    expect(app.push).not.toHaveBeenCalled();
    joined.resolve();
    expect(await start).toBe("started");
    await flush();
    expect(app.push.mock.calls.map((call) => call[1].name)).toEqual(["page"]);
  });

  it.each(["credentials", "join"])(
    "stop cancels a pending %s stage",
    async (stage) => {
      const credentials = deferred<typeof grant>();
      const joined = deferred<void>();
      const app = harness({
        credentials: credentials.promise,
        joined: joined.promise,
      });
      const start = app.start();
      if (stage === "join") {
        credentials.resolve(grant);
        await flush();
      }
      app.stop();
      credentials.resolve(grant);
      joined.resolve();
      expect(await start).toBe("cancelled");
      click();
      await flush();
      expect(app.collector.trajectoryId).toBeNull();
      expect(app.push).not.toHaveBeenCalled();
      expect(app.join).toHaveBeenCalledTimes(stage === "join" ? 1 : 0);
      expect(app.leave).toHaveBeenCalledTimes(stage === "join" ? 1 : 0);
    },
  );

  it("sends null for a route without a configured template", async () => {
    const app = harness();
    await app.start();
    history.pushState(null, "", "/users/private-name");
    click();
    await flush();
    expect(app.push.mock.calls[1]?.[1]).toMatchObject({
      name: "navigation",
      value: { from: "/deals", to: null },
    });
    expect(app.push.mock.calls[2]?.[1]).toMatchObject({
      name: "click",
      value: { route: null },
    });
    expect(JSON.stringify(app.records)).not.toContain("private-name");
  });

  it("does not resend events after a mocked persistence failure", async () => {
    const app = harness({ rejectPush: true });
    await app.start();
    await flush();
    expect(app.failures).toEqual([new Error("PERSISTENCE_FAILED")]);
    await vi.advanceTimersByTimeAsync(10_000);
    app.stop();
    expect(app.push).toHaveBeenCalledTimes(1);
    expect(app.receipts).toEqual([]);
    expect(app.records).toEqual([]);
  });
});
