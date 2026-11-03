import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningSink } from "@copilotkit/learning";
import { CopilotKitCore } from "../core";
import { ɵLearningAutoStarter, ɵtoLearningConfig } from "../learning-autostart";
import type { ɵLearningProp } from "../learning-autostart";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const sink: LearningSink = () => {};

/** A custom-sink config: capture starts synchronously, without a runtime. */
function sinkLearning({
  capture,
  ...overrides
}: {
  trajectoryId?: string;
  autoStart?: boolean;
  capture?: { clicks?: boolean };
} = {}): ɵLearningProp {
  return {
    sink,
    capture: { clicks: false, navigation: false, network: false, ...capture },
    ...overrides,
  };
}

function setup() {
  const core = new CopilotKitCore({});
  const starter = new ɵLearningAutoStarter(core);
  return { core, starter };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Core tests run in Node; supply the browser globals page capture reads.
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("location", new URL("http://localhost/learning"));
  vi.stubGlobal("document", { title: "Learning", referrer: "" });
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ɵtoLearningConfig", () => {
  it("maps true to one shared default config", () => {
    expect(ɵtoLearningConfig(true)).toEqual({});
    expect(ɵtoLearningConfig(true)).toBe(ɵtoLearningConfig(true));
  });

  it.each([false, undefined])("turns capture off for %s", (learning) => {
    expect(ɵtoLearningConfig(learning)).toBeUndefined();
  });

  it("removes the provider-only autoStart flag", () => {
    expect(ɵtoLearningConfig({ autoStart: false, trajectoryId: "t" })).toEqual({
      trajectoryId: "t",
    });
  });
});

describe("ɵLearningAutoStarter", () => {
  it("starts a Trajectory with a generated ID", () => {
    const { core, starter } = setup();

    starter.update(sinkLearning());

    expect(core.trajectoryId).toMatch(UUID);
  });

  it("starts with a supplied trajectoryId", () => {
    const { core, starter } = setup();

    starter.update(sinkLearning({ trajectoryId: "mine" }));

    expect(core.trajectoryId).toBe("mine");
  });

  it("configures core without starting when autoStart is false", () => {
    const { core, starter } = setup();

    starter.update(sinkLearning({ autoStart: false }));

    expect(core.ɵlearningConfigured).toBe(true);
    expect(core.trajectoryId).toBeNull();
  });

  it("keeps the generated ID across option changes that keep generating", () => {
    const { core, starter } = setup();
    starter.update(sinkLearning());
    const first = core.trajectoryId;

    starter.update(sinkLearning({ capture: { clicks: true } }));

    expect(core.trajectoryId).toBe(first);
  });

  it("restarts with the same generated ID after dispose and update", () => {
    const { core, starter } = setup();
    const learning = sinkLearning();
    starter.update(learning);
    const first = core.trajectoryId;

    starter.dispose();
    expect(core.trajectoryId).toBeNull();
    starter.update(learning);

    expect(core.trajectoryId).toBe(first);
  });

  it("generates a new ID after a supplied ID replaced the generated one", () => {
    const { core, starter } = setup();
    starter.update(sinkLearning());
    const first = core.trajectoryId;

    starter.update(sinkLearning({ trajectoryId: "mine" }));
    starter.update(sinkLearning());

    expect(core.trajectoryId).toMatch(UUID);
    expect(core.trajectoryId).not.toBe(first);
  });

  it("stops a Trajectory the app started itself on dispose", () => {
    const { core, starter } = setup();
    starter.update(sinkLearning({ autoStart: false }));
    void core.startTrajectory({ trajectoryId: "manual" });

    starter.dispose();

    expect(core.trajectoryId).toBeNull();
  });

  it("turns capture off and stops when learning becomes false", () => {
    const { core, starter } = setup();
    starter.update(sinkLearning());

    starter.update(false);

    expect(core.trajectoryId).toBeNull();
    expect(core.ɵlearningConfigured).toBe(false);
  });

  it("warns once that trajectoryId is ignored without autoStart", () => {
    const { starter } = setup();

    starter.update(sinkLearning({ autoStart: false, trajectoryId: "t" }));
    starter.update(sinkLearning({ autoStart: false, trajectoryId: "t" }));

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[CopilotKit] learning.trajectoryId is ignored when autoStart is false; pass the ID to startTrajectory() instead.",
    );
  });

  it("warns once about learningContainerIds without a custom sink", () => {
    const { starter } = setup();
    const learning = { autoStart: false, learningContainerIds: ["c"] };

    starter.update({ ...learning });
    starter.update({ ...learning });

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(
        "learningContainerIds is supported only with a custom sink",
      ),
    );
  });

  it("warns when an active start rejects unexpectedly", async () => {
    const { core, starter } = setup();
    vi.spyOn(core, "startTrajectory").mockRejectedValue(new Error("boom"));

    starter.update(sinkLearning());
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[CopilotKit] Failed to start interaction capture.",
    );
  });

  it("stays quiet when a replaced start rejects late", async () => {
    const { core, starter } = setup();
    let reject: (error: Error) => void = () => {};
    vi.spyOn(core, "startTrajectory").mockReturnValue(
      new Promise((_resolve, rejectStart) => {
        reject = rejectStart;
      }),
    );
    starter.update(sinkLearning());

    starter.dispose();
    reject(new Error("late"));
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).not.toHaveBeenCalled();
  });
});
