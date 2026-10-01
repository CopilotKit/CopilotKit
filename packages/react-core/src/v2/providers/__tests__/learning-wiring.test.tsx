import React, { StrictMode } from "react";
import { render } from "@testing-library/react";
import type { LearningConfig } from "@copilotkit/core";
import { CopilotKitProvider } from "../CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../CopilotChatConfigurationProvider";

// react-core reaches @copilotkit/learning only through Core, so derive its types from Core.
type LearningSink = LearningConfig["sink"];
type LearningBatch = Parameters<LearningSink>[0];

const nativePushState = History.prototype.pushState;
let batches: LearningBatch[] = [];

const sink: LearningSink = (batch) => {
  batches.push(batch);
};

function App({
  threadId,
  learning = true,
}: {
  threadId: string;
  learning?: boolean;
}) {
  return (
    <StrictMode>
      <CopilotKitProvider
        learning={
          learning
            ? { sink, trajectoryId: "traj-1", capture: { network: false } }
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
  it("starts once under StrictMode and links the open Thread", () => {
    const view = render(<App threadId="t-1" />);

    history.pushState(null, "", "/learning/deals/42");
    const events = drain();
    view.unmount();

    expect(events.map((event) => event.name)).toEqual([
      "page",
      "thread.linked",
      "navigation",
    ]);
    expect(events[1]?.value).toMatchObject({
      threadId: "t-1",
      agentId: "default",
      reason: "start",
    });
  });

  it("emits a switch when the open Thread changes", () => {
    const view = render(<App threadId="t-1" />);

    view.rerender(<App threadId="t-2" />);
    const linked = drain().filter((event) => event.name === "thread.linked");
    view.unmount();

    expect(
      linked.map((event) => [event.value.threadId, event.value.reason]),
    ).toEqual([
      ["t-1", "start"],
      ["t-2", "switch"],
    ]);
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

    expect(drain()).toEqual([]);
    expect(History.prototype.pushState).toBe(nativePushState);
    view.unmount();
  });
});
