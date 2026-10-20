import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { AssistantMessage } from "@ag-ui/core";
import { CopilotKitCore } from "@copilotkit/core";
import type { LearningConfig } from "@copilotkit/core";
import { z } from "zod";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { useCopilotKit } from "../../../context";
import { defineToolCallRenderer } from "../../../types";
import { CopilotChatToolCallsView } from "../CopilotChatToolCallsView";

const message: AssistantMessage = {
  id: "message-1",
  role: "assistant",
  toolCalls: [
    {
      id: "tool-1",
      type: "function",
      function: { name: "approve", arguments: "{}" },
    },
  ],
};
const renderers = [
  defineToolCallRenderer({
    name: "approve",
    args: z.object({}),
    render: () => <button>Approve</button>,
  }),
];
const learning: LearningConfig = {
  sink: () => {},
  capture: { clicks: false, navigation: false, network: false },
};
// Tests that drive Trajectory changes themselves must not race the provider's
// automatic start.
const manualLearning: React.ComponentProps<
  typeof CopilotKitProvider
>["learning"] = { ...learning, autoStart: false };

function CaptureControls({
  onCore,
}: {
  onCore: (core: CopilotKitCore) => void;
}) {
  onCore(useCopilotKit().copilotkit);
  return null;
}

describe("tool call capture attributes", () => {
  it("keeps tool UI as a direct child when learning is disabled", () => {
    const view = render(
      <CopilotKitProvider renderToolCalls={renderers}>
        <div data-testid="message">
          <CopilotChatToolCallsView message={message} />
        </div>
      </CopilotKitProvider>,
    );

    expect(screen.getByRole("button", { name: "Approve" }).parentElement).toBe(
      screen.getByTestId("message"),
    );
    expect(view.container.querySelector("[data-tool-call-id]")).toBeNull();
  });

  it("keeps one wrapper while learning is configured, whatever the Trajectory state", async () => {
    let core: CopilotKitCore | undefined;
    const view = render(
      <CopilotKitProvider learning={manualLearning} renderToolCalls={renderers}>
        <CaptureControls
          onCore={(value) => {
            core = value;
          }}
        />
        <div data-testid="message">
          <CopilotChatToolCallsView message={message} />
        </div>
      </CopilotKitProvider>,
    );

    const wrapper = () =>
      screen.getByRole("button", { name: "Approve" }).parentElement;
    const initial = wrapper();
    expect(initial?.getAttribute("data-tool-call-id")).toBe("tool-1");
    expect(initial?.parentElement).toBe(screen.getByTestId("message"));
    expect(core?.trajectoryId).toBeNull();

    await act(async () => {
      await expect(
        core?.startTrajectory({ trajectoryId: "traj-1" }),
      ).resolves.toMatchObject({ status: "started" });
    });
    expect(core?.trajectoryId).toBe("traj-1");
    expect(wrapper()).toBe(initial);
    act(() => core?.stopTrajectory());
    expect(wrapper()).toBe(initial);
    expect(view.container.querySelectorAll("[data-tool-call-id]")).toHaveLength(
      1,
    );
  });

  it("keeps tool UI state and mount effects across Trajectory changes", async () => {
    let mounts = 0;
    function StatefulApproval() {
      const [count, setCount] = React.useState(0);
      React.useEffect(() => {
        mounts += 1;
      }, []);
      return (
        <>
          <input aria-label="Reason" defaultValue="" />
          <button onClick={() => setCount((value) => value + 1)}>
            Clicked {count}
          </button>
        </>
      );
    }
    const statefulRenderers = [
      defineToolCallRenderer({
        name: "approve",
        args: z.object({}),
        render: () => <StatefulApproval />,
      }),
    ];
    let core: CopilotKitCore | undefined;
    render(
      <CopilotKitProvider
        learning={manualLearning}
        renderToolCalls={statefulRenderers}
      >
        <CaptureControls
          onCore={(value) => {
            core = value;
          }}
        />
        <CopilotChatToolCallsView message={message} />
      </CopilotKitProvider>,
    );

    const input = screen.getByRole("textbox", { name: "Reason" });
    fireEvent.change(input, { target: { value: "looks good" } });
    fireEvent.click(screen.getByRole("button", { name: "Clicked 0" }));

    // Mirrors connection start, failure and reconnect: null -> id -> null -> id.
    expect(core?.trajectoryId).toBeNull();
    await act(async () => {
      await expect(
        core?.startTrajectory({ trajectoryId: "traj-1" }),
      ).resolves.toMatchObject({ status: "started" });
    });
    expect(core?.trajectoryId).toBe("traj-1");
    act(() => core?.stopTrajectory());
    expect(core?.trajectoryId).toBeNull();
    await act(async () => {
      await expect(
        core?.startTrajectory({ trajectoryId: "traj-2" }),
      ).resolves.toMatchObject({ status: "started" });
    });
    expect(core?.trajectoryId).toBe("traj-2");

    expect(screen.getByRole("textbox", { name: "Reason" })).toBe(input);
    expect(input).toHaveProperty("value", "looks good");
    expect(screen.getByRole("button", { name: "Clicked 1" })).toBeTruthy();
    expect(mounts).toBe(1);
    act(() => core?.stopTrajectory());
  });

  it("adds and removes the wrapper only with the learning configuration", () => {
    const tree = (config?: LearningConfig) => (
      <CopilotKitProvider learning={config} renderToolCalls={renderers}>
        <div data-testid="message">
          <CopilotChatToolCallsView message={message} />
        </div>
      </CopilotKitProvider>
    );
    const view = render(tree());
    expect(view.container.querySelector("[data-tool-call-id]")).toBeNull();

    view.rerender(tree(learning));
    expect(
      screen
        .getByRole("button", { name: "Approve" })
        .parentElement?.getAttribute("data-tool-call-id"),
    ).toBe("tool-1");

    view.rerender(tree());
    expect(view.container.querySelector("[data-tool-call-id]")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" }).parentElement).toBe(
      screen.getByTestId("message"),
    );
  });

  it("does not resubscribe to Core on every render", () => {
    const subscribe = vi.spyOn(
      CopilotKitCore.prototype,
      "ɵsubscribeToLearningConfigured",
    );
    const tree = (content: string) => (
      <CopilotKitProvider learning={learning} renderToolCalls={renderers}>
        <CopilotChatToolCallsView message={{ ...message, content }} />
      </CopilotKitProvider>
    );
    const view = render(tree("a"));
    const subscriptions = subscribe.mock.calls.length;
    expect(subscriptions).toBeGreaterThan(0);

    view.rerender(tree("ab"));
    view.rerender(tree("abc"));
    expect(subscribe).toHaveBeenCalledTimes(subscriptions);
    subscribe.mockRestore();
  });

  it("does not leave an empty wrapper when there is no tool renderer", () => {
    render(
      <CopilotKitProvider learning={{ ...learning, trajectoryId: "traj-1" }}>
        <div data-testid="message">
          <CopilotChatToolCallsView message={message} />
        </div>
      </CopilotKitProvider>,
    );

    expect(screen.getByTestId("message").childNodes).toHaveLength(0);
  });
});
