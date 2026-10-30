import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { cleanup, render } from "@testing-library/vue";
import type { CopilotKitCore, LegacyLearningConfig } from "@copilotkit/core";
import CopilotKitProvider from "../CopilotKitProvider.vue";
import type { CopilotKitLearningOptions } from "../CopilotKitProvider.types";
import { useCopilotKit } from "../useCopilotKit";
import { CopilotKitCoreVue } from "../../lib/vue-core";

// Ported from React's learning-wiring and trajectory-wiring tests. Core and
// browser capture are real. Authenticated capture is checked at its connect
// request; the realtime channel after it is Core's, and React's tests cover it.

type Learning = boolean | CopilotKitLearningOptions;
type LearningSink = LegacyLearningConfig["sink"];
type LearningBatch = Parameters<LearningSink>[0];

const FIRST_ID = "10000000-0000-4000-8000-000000000001";
const SECOND_ID = "10000000-0000-4000-8000-000000000002";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const nativePushState = History.prototype.pushState;

let core: CopilotKitCore;
const CoreProbe = defineComponent({
  setup() {
    core = useCopilotKit().copilotkit.value;
    return () => null;
  },
});

/**
 * Renders the provider. `learning` is left off the provider when the ref
 * holds `"missing"`, to check the absent prop rather than `undefined`.
 */
function renderApp(initial: Learning | undefined | "missing") {
  const learning = ref<Learning | undefined | "missing">(initial);
  const show = ref(true);
  const App = defineComponent({
    setup() {
      return () =>
        show.value
          ? h(
              CopilotKitProvider,
              {
                runtimeUrl: "/api/copilotkit",
                // Runtime discovery is mocked out, so pin the transport: with
                // "auto", capture waits for discovery before connecting.
                useSingleEndpoint: true,
                ...(learning.value === "missing"
                  ? {}
                  : { learning: learning.value }),
              },
              { default: () => h(CoreProbe) },
            )
          : null;
    },
  });
  const view = render(App);
  const rerender = async (next: Learning | undefined | "missing") => {
    learning.value = next;
    await nextTick();
  };
  const unmount = async () => {
    show.value = false;
    await nextTick();
  };
  return { view, rerender, unmount };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let fetchStub: ReturnType<typeof vi.fn>;

/** The bodies of the Trajectory connect requests sent so far. */
function connectRequests(): {
  method: string;
  params: { trajectoryId: string };
}[] {
  return fetchStub.mock.calls
    .map(([, init]) => JSON.parse(String(init?.body ?? "{}")))
    .filter((body) => body.method === "trajectory/connect");
}
const connectedIds = () =>
  connectRequests().map((body) => body.params.trajectoryId);

beforeEach(() => {
  history.replaceState(null, "", "/deals");
  // Keep runtime discovery out of these tests; the app pins the transport.
  vi.spyOn(CopilotKitCoreVue.prototype, "connect").mockImplementation(() => {});
  // Requests stay pending: these tests stop at the connect request.
  fetchStub = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetchStub);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CopilotKitProvider learning prop", () => {
  describe("with a custom sink", () => {
    let batches: LearningBatch[] = [];
    const sink: LearningSink = (batch) => {
      batches.push(batch);
    };
    const withSink = (
      options: Partial<CopilotKitLearningOptions> = {},
    ): CopilotKitLearningOptions =>
      ({
        sink,
        trajectoryId: "traj-1",
        capture: { network: false },
        ...options,
      }) as CopilotKitLearningOptions;

    function drain() {
      window.dispatchEvent(new Event("pagehide"));
      return batches.flatMap((batch) =>
        batch.events.map((event) => ({
          name: event.name,
          value: event.value,
        })),
      );
    }

    beforeEach(() => {
      batches = [];
    });

    it("starts capture when learning becomes available after mount", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const app = renderApp(false);

      await app.rerender(withSink());
      history.pushState(null, "", "/deals/42");
      const events = drain();
      await app.unmount();

      expect(events.map((event) => event.name)).toEqual(["page", "navigation"]);
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining("startTrajectory()"),
      );
    });

    it("starts a custom sink without a trajectoryId using a generated ID", async () => {
      const app = renderApp({
        sink,
        capture: { network: false },
      } as CopilotKitLearningOptions);
      const events = drain();
      await app.unmount();

      expect(events.map((event) => event.name)).toEqual(["page"]);
      expect(batches[0]?.trajectoryId).toMatch(UUID);
    });

    it("uses the latest config and container IDs for the next Trajectory", async () => {
      const nextBatches: LearningBatch[] = [];
      const nextSink: LearningSink = (batch) => {
        nextBatches.push(batch);
      };
      const app = renderApp(withSink({ learningContainerIds: ["old"] }));
      drain();
      batches = [];

      await app.rerender(
        withSink({ learningContainerIds: ["new"], sink: nextSink }),
      );
      history.pushState(null, "", "/deals/42");
      expect(drain().map((event) => event.name)).toEqual(["navigation"]);
      expect(batches[0]?.learningContainerIds).toEqual(["old"]);
      expect(nextBatches).toEqual([]);

      await app.rerender(
        withSink({
          trajectoryId: "traj-2",
          learningContainerIds: ["new"],
          sink: nextSink,
        }),
      );
      drain();
      await app.unmount();

      expect(nextBatches).toHaveLength(1);
      expect(nextBatches[0]).toMatchObject({
        trajectoryId: "traj-2",
        learningContainerIds: ["new"],
      });
      expect(nextBatches[0]?.events.map((event) => event.name)).toEqual([
        "page",
      ]);
    });

    it("flushes to the previous sink and stops when learning is removed", async () => {
      const app = renderApp(withSink());
      drain();
      batches = [];
      history.pushState(null, "", "/deals/42");

      await app.rerender(false);
      expect(
        batches.flatMap((batch) => batch.events.map((event) => event.name)),
      ).toEqual(["navigation"]);
      batches = [];
      history.pushState(null, "", "/deals/43");
      expect(drain()).toEqual([]);
      expect(History.prototype.pushState).toBe(nativePushState);
    });

    it("stops capture on unmount", async () => {
      const app = renderApp(withSink());
      drain();
      batches = [];

      await app.unmount();
      history.pushState(null, "", "/deals/7");

      expect(drain()).toEqual([]);
      expect(History.prototype.pushState).toBe(nativePushState);
    });

    it("installs nothing without the learning prop", async () => {
      const app = renderApp("missing");

      history.pushState(null, "", "/deals/8");
      expect(drain()).toEqual([]);
      expect(History.prototype.pushState).toBe(nativePushState);
      await app.unmount();
    });
  });

  describe("authenticated capture", () => {
    const CONTAINER_WARNING =
      "learningContainerIds is supported only with a custom sink. Authenticated Trajectory capture ignores it; assign Learning Spaces on the server with getTrajectoryLearningContainerIds";
    const containerWarnings = (warn: ReturnType<typeof vi.spyOn>) =>
      warn.mock.calls.filter(([message]) =>
        String(message).includes(CONTAINER_WARNING),
      ).length;

    // Exactly one warning per mount: Core warns when the provider starts with
    // the options, and the provider warns only when it does not start.
    it.each<{
      name: string;
      learning: CopilotKitLearningOptions;
      manualStartId?: string;
      connectedId?: string;
    }>([
      {
        name: "auto start with a supplied ID, warned by Core",
        learning: {
          trajectoryId: FIRST_ID,
          autoStart: true,
          learningContainerIds: ["private-container"],
        },
        connectedId: FIRST_ID,
      },
      {
        name: "default auto start with a generated ID, warned by Core",
        learning: { learningContainerIds: ["private-container"] },
      },
      {
        name: "manual start, warned by the provider",
        learning: {
          autoStart: false,
          learningContainerIds: ["private-container"],
        },
        manualStartId: FIRST_ID,
        connectedId: FIRST_ID,
      },
      {
        name: "manual start with an ignored trajectoryId, warned by the provider",
        learning: {
          autoStart: false,
          trajectoryId: SECOND_ID,
          learningContainerIds: ["private-container"],
        },
        manualStartId: FIRST_ID,
        connectedId: FIRST_ID,
      },
    ])(
      "warns once about provider container options without sending them ($name)",
      ({ learning, manualStartId, connectedId }) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        renderApp(learning);

        expect(containerWarnings(warn)).toBe(1);
        expect(JSON.stringify(warn.mock.calls)).not.toContain(
          "private-container",
        );
        if (manualStartId !== undefined) {
          void core.startTrajectory({ trajectoryId: manualStartId });
        }
        expect(connectRequests()).toEqual([
          {
            method: "trajectory/connect",
            params: {
              trajectoryId: connectedId ?? expect.stringMatching(UUID),
            },
            body: {},
          },
        ]);
        expect(containerWarnings(warn)).toBe(1);
      },
    );

    it("cancels the previous authentication when the supplied ID changes", async () => {
      const stop = vi.spyOn(CopilotKitCoreVue.prototype, "stopTrajectory");
      const app = renderApp({ trajectoryId: FIRST_ID });
      await app.rerender({ trajectoryId: SECOND_ID });

      expect(connectedIds()).toEqual([FIRST_ID, SECOND_ID]);
      expect(stop).toHaveBeenCalledTimes(1);
    });

    it("cancels a manual start on unmount when autoStart is false", async () => {
      const app = renderApp({ autoStart: false });
      expect(connectedIds()).toEqual([]);

      const start = core.startTrajectory();
      await app.unmount();
      await expect(start).resolves.toEqual({
        status: "error",
        code: "CANCELLED",
      });
    });

    it("consumes unexpected startup rejections without exposing the underlying error", async () => {
      vi.spyOn(
        CopilotKitCoreVue.prototype,
        "startTrajectory",
      ).mockRejectedValue(new Error("private token"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      renderApp({ trajectoryId: FIRST_ID });
      await nextTick();

      expect(warn).toHaveBeenCalledWith(
        "[CopilotKit] Failed to start interaction capture.",
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain("private token");
    });

    it("silences a previous start rejection without stopping the replacement", async () => {
      const previous =
        deferred<Awaited<ReturnType<CopilotKitCore["startTrajectory"]>>>();
      const start = vi
        .spyOn(CopilotKitCoreVue.prototype, "startTrajectory")
        .mockImplementationOnce(() => previous.promise)
        .mockResolvedValue({ status: "started", trajectoryId: SECOND_ID });
      const stop = vi.spyOn(CopilotKitCoreVue.prototype, "stopTrajectory");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const app = renderApp({ trajectoryId: FIRST_ID });
      await app.rerender({ trajectoryId: SECOND_ID });
      expect(start).toHaveBeenCalledTimes(2);
      expect(stop).toHaveBeenCalledTimes(1);

      previous.reject(new Error("late failure"));
      await new Promise((done) => setTimeout(done, 0));
      expect(warn).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalledTimes(1);
    });

    describe("generated Trajectory IDs", () => {
      it("generates a Trajectory ID and starts capture after mount", () => {
        renderApp(true);

        expect(connectedIds()).toEqual([expect.stringMatching(UUID)]);
        expect(core.ɵlearningConfigured).toBe(true);
      });

      it("treats the bare learning attribute as true", () => {
        // `<CopilotKitProvider learning>` passes an empty string.
        renderApp("" as unknown as Learning);

        expect(connectedIds()).toEqual([expect.stringMatching(UUID)]);
        expect(core.ɵlearningConfigured).toBe(true);
      });

      it.each([false, undefined, "missing" as const])(
        "keeps capture off for learning=%s",
        (learning) => {
          renderApp(learning);

          expect(connectedIds()).toEqual([]);
          expect(core.ɵlearningConfigured).toBe(false);
        },
      );

      it("keeps the generated ID across rerenders", async () => {
        const app = renderApp(true);
        await app.rerender(true);
        await app.rerender({});
        await app.rerender({});

        expect(connectedIds()).toEqual([expect.stringMatching(UUID)]);
      });

      it("stops on disable and starts a new Trajectory with a new ID when enabled again", async () => {
        const app = renderApp(true);
        const [first] = connectedIds();

        await app.rerender(false);
        expect(core.trajectoryId).toBeNull();
        expect(core.ɵlearningConfigured).toBe(false);

        await app.rerender(true);
        const [, second] = connectedIds();
        expect(second).toMatch(UUID);
        expect(second).not.toBe(first);
      });

      it("switches between the shorthand and a supplied ID", async () => {
        const app = renderApp(true);
        await app.rerender({ trajectoryId: SECOND_ID });
        await app.rerender({});
        const [first, second, third] = connectedIds();
        expect(second).toBe(SECOND_ID);
        expect(third).toMatch(UUID);
        expect(third).not.toBe(first);

        await app.rerender({ autoStart: false });
        expect(core.trajectoryId).toBeNull();
        expect(connectedIds()).toEqual([first, SECOND_ID, third]);
      });

      it("keeps one Trajectory when an inline object rerenders", async () => {
        const onError = vi.fn();
        const stop = vi.spyOn(CopilotKitCoreVue.prototype, "stopTrajectory");
        const app = renderApp({ onError });
        await app.rerender({ onError });
        await app.rerender({ onError });

        expect(connectedIds()).toEqual([expect.stringMatching(UUID)]);
        expect(stop).not.toHaveBeenCalled();
      });

      it("keeps the generated ID when switching between generating forms", async () => {
        const onError = vi.fn();
        const stop = vi.spyOn(CopilotKitCoreVue.prototype, "stopTrajectory");
        const app = renderApp(true);
        await app.rerender({ onError });
        await app.rerender({
          onError,
          ignoreUrls: ["https://private.invalid"],
        });

        expect(connectedIds()).toEqual([expect.stringMatching(UUID)]);
        expect(stop).not.toHaveBeenCalled();
      });

      it("stops when autoStart turns off and generates a new ID when it turns on again", async () => {
        const onError = vi.fn();
        const stop = vi.spyOn(CopilotKitCoreVue.prototype, "stopTrajectory");
        const app = renderApp({ onError });
        const [first] = connectedIds();

        await app.rerender({ onError, autoStart: false });
        expect(stop).toHaveBeenCalledTimes(1);
        expect(core.ɵlearningConfigured).toBe(true);

        await app.rerender({ onError });
        const [, second] = connectedIds();
        expect(second).toMatch(UUID);
        expect(second).not.toBe(first);
      });

      it("stops capture on unmount", async () => {
        const stop = vi.spyOn(CopilotKitCoreVue.prototype, "stopTrajectory");
        const app = renderApp(true);

        await app.unmount();
        expect(stop).toHaveBeenCalledTimes(1);
        expect(History.prototype.pushState).toBe(nativePushState);
      });

      it("lets a manual start join the generated Trajectory instead of starting another", () => {
        renderApp(true);
        void core.startTrajectory();

        expect(connectedIds()).toEqual([expect.stringMatching(UUID)]);
      });
    });

    describe("autoStart: false", () => {
      it("waits for a manual start", () => {
        renderApp({ autoStart: false });
        expect(connectedIds()).toEqual([]);
        expect(core.ɵlearningConfigured).toBe(true);

        void core.startTrajectory({ trajectoryId: FIRST_ID });
        expect(connectedIds()).toEqual([FIRST_ID]);
      });

      it("ignores a supplied trajectoryId and warns once without the ID", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        // A new inline object on every render must not repeat the warning.
        const app = renderApp({ autoStart: false, trajectoryId: FIRST_ID });
        await app.rerender({ autoStart: false, trajectoryId: FIRST_ID });
        await app.rerender({ autoStart: false, trajectoryId: FIRST_ID });

        expect(connectedIds()).toEqual([]);
        expect(core.trajectoryId).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]![0]).toContain(
          "[CopilotKit] learning.trajectoryId is ignored when autoStart is false",
        );
        expect(JSON.stringify(warn.mock.calls)).not.toContain(FIRST_ID);
      });

      it("does not pass autoStart to Core", async () => {
        const setLearningConfig = vi.spyOn(
          CopilotKitCoreVue.prototype,
          "setLearningConfig",
        );
        const app = renderApp({ autoStart: false, routes: ["/deals"] });
        await app.rerender({ autoStart: true, routes: ["/deals"] });

        expect(setLearningConfig).toHaveBeenCalled();
        for (const [config] of setLearningConfig.mock.calls) {
          expect(config).toEqual({ routes: ["/deals"] });
        }
      });
    });
  });
});
