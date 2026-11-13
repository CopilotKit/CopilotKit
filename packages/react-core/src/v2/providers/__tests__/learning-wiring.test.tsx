import React, { StrictMode } from "react";
import { render } from "@testing-library/react";
import type { LegacyLearningConfig } from "@copilotkit/core";
import { CopilotKitProvider } from "../CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../CopilotChatConfigurationProvider";

// react-core reaches @copilotkit/learning only through Core, so derive its types from Core.
type LearningSink = LegacyLearningConfig["sink"];
type LearningBatch = Parameters<LearningSink>[0];

const nativePushState = History.prototype.pushState;
let batches: LearningBatch[] = [];

const sink: LearningSink = (batch) => {
  batches.push(batch);
};

function App({
  threadId,
  learning = true,
  trajectoryId = "traj-1",
  learningContainerIds,
  learningConfig,
}: {
  threadId: string;
  learning?: boolean;
  trajectoryId?: string;
  learningContainerIds?: string[];
  learningConfig?: Partial<LegacyLearningConfig>;
}) {
  return (
    <StrictMode>
      <CopilotKitProvider
        learning={
          learning
            ? {
                sink,
                trajectoryId,
                learningContainerIds,
                capture: { network: false },
                ...learningConfig,
              }
            : undefined
        }
      >
        <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
          <div />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    </StrictMode>
  );
}

function drain() {
  window.dispatchEvent(new Event("pagehide"));
  return batches.flatMap((batch) =>
    batch.events.map((event) => ({ name: event.name, value: event.value })),
  );
}

beforeEach(() => {
  batches = [];
  history.replaceState(null, "", "/learning");
});

describe("CopilotKitProvider learning prop", () => {
  it("starts capture when learning becomes available after mount", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const view = render(<App threadId="t-1" learning={false} />);

    view.rerender(<App threadId="t-1" />);
    history.pushState(null, "", "/learning/deals/42");
    const events = drain();
    view.unmount();

    expect(events.map((event) => event.name)).toEqual([
      "page",
      "thread.linked",
      "navigation",
    ]);
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("startTrajectory()"),
    );
    warn.mockRestore();
  });

  it("starts a custom sink without a trajectoryId using a generated ID", () => {
    const view = render(
      <CopilotKitProvider learning={{ sink, capture: { network: false } }}>
        <CopilotChatConfigurationProvider agentId="default" threadId="t-1">
          <div />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
    const events = drain();
    view.unmount();

    expect(events.map((event) => event.name)).toEqual([
      "page",
      "thread.linked",
    ]);
    // The shared test setup pins randomUUID, so this is the provider's ID.
    expect(batches[0]?.trajectoryId).toBe("mock-thread-id");
  });

  it("uses the latest config and container IDs for the next Trajectory", () => {
    const nextBatches: LearningBatch[] = [];
    const nextConfig: Partial<LegacyLearningConfig> = {
      sink: (batch) => {
        nextBatches.push(batch);
      },
    };
    const view = render(<App threadId="t-1" learningContainerIds={["old"]} />);
    drain();
    batches = [];

    view.rerender(
      <App
        threadId="t-1"
        learningContainerIds={["new"]}
        learningConfig={nextConfig}
      />,
    );
    history.pushState(null, "", "/learning/deals/42");
    expect(drain().map((event) => event.name)).toEqual(["navigation"]);
    expect(batches[0]?.learningContainerIds).toEqual(["old"]);
    expect(nextBatches).toEqual([]);

    view.rerender(
      <App
        threadId="t-1"
        trajectoryId="traj-2"
        learningContainerIds={["new"]}
        learningConfig={nextConfig}
      />,
    );
    drain();
    view.unmount();

    expect(nextBatches).toHaveLength(1);
    expect(nextBatches[0]).toMatchObject({
      trajectoryId: "traj-2",
      learningContainerIds: ["new"],
    });
    expect(nextBatches[0]?.events.map((event) => event.name)).toEqual([
      "page",
      "thread.linked",
    ]);
  });

  it("flushes to the previous sink and stops when learning is removed", () => {
    const view = render(<App threadId="t-1" />);
    drain();
    batches = [];
    history.pushState(null, "", "/learning/deals/42");

    view.rerender(<App threadId="t-1" learning={false} />);
    expect(
      batches.flatMap((batch) => batch.events.map((event) => event.name)),
    ).toEqual(["navigation"]);
    batches = [];
    history.pushState(null, "", "/learning/deals/43");
    expect(drain()).toEqual([]);
    expect(History.prototype.pushState).toBe(nativePushState);
    view.unmount();
  });

  it("keeps one set of capture hooks under StrictMode and links the open Thread", () => {
    // React 19 only replays initial effects when StrictMode is at the root.
    // Exercise setup/cleanup/setup in both supported React versions. Cleanup
    // flushes the first capture, so each setup emits its own page and link.
    const view = render(<App threadId="t-1" />, { wrapper: StrictMode });
    const startupEvents = drain();

    expect(
      batches.map((batch) => batch.events.map((event) => event.name)),
    ).toEqual([
      ["page", "thread.linked"],
      ["page", "thread.linked"],
    ]);
    expect(
      startupEvents
        .filter((event) => event.name === "thread.linked")
        .map((event) => event.value),
    ).toEqual([
      expect.objectContaining({
        threadId: "t-1",
        agentId: "default",
        reason: "start",
      }),
      expect.objectContaining({
        threadId: "t-1",
        agentId: "default",
        reason: "start",
      }),
    ]);
    batches = [];

    history.pushState(null, "", "/learning/deals/42");
    const events = drain();
    view.unmount();

    // Replayed effects must leave one active listener, not one per setup.
    expect(events.map((event) => event.name)).toEqual(["navigation"]);
    expect(History.prototype.pushState).toBe(nativePushState);
  });

  it("emits a switch when the open Thread changes", () => {
    const view = render(<App threadId="t-1" />);
    // Initial effect replay differs between React 18 and 19. Start from the
    // settled mount and test the user-visible thread change independently.
    drain();
    batches = [];
    const capturePushState = History.prototype.pushState;

    view.rerender(<App threadId="t-2" />);
    const events = drain();

    expect(
      events.map((event) => [
        event.name,
        event.value.threadId,
        event.value.reason,
      ]),
    ).toEqual([["thread.linked", "t-2", "switch"]]);
    expect(History.prototype.pushState).toBe(capturePushState);

    batches = [];
    view.rerender(<App threadId="t-2" />);
    expect(drain()).toEqual([]);
    view.unmount();
  });

  it("stops capture on unmount", () => {
    const view = render(<App threadId="t-1" />);
    drain();
    batches = [];

    view.unmount();
    history.pushState(null, "", "/learning/deals/7");

    expect(drain()).toEqual([]);
    expect(History.prototype.pushState).toBe(nativePushState);
  });

  it("installs nothing without the learning prop", () => {
    const view = render(<App threadId="t-1" learning={false} />);

    history.pushState(null, "", "/learning/deals/8");
    view.rerender(<App threadId="t-2" learning={false} />);
    history.pushState(null, "", "/learning/deals/9");

    expect(drain()).toEqual([]);
    expect(History.prototype.pushState).toBe(nativePushState);
    view.unmount();
    history.pushState(null, "", "/learning/deals/10");
    expect(drain()).toEqual([]);
    expect(History.prototype.pushState).toBe(nativePushState);
  });
});
