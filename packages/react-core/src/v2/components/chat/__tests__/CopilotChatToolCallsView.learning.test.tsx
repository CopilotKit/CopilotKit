import React from "react";
import { act, render, screen } from "@testing-library/react";
import type { AssistantMessage } from "@ag-ui/core";
import type { CopilotKitCore, LearningConfig } from "@copilotkit/core";
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

  it("adds capture attributes only while a manually started Trajectory is active", async () => {
    let core: CopilotKitCore | undefined;
    const view = render(
      <CopilotKitProvider learning={learning} renderToolCalls={renderers}>
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

    expect(view.container.querySelector("[data-tool-call-id]")).toBeNull();
    await act(async () => {
      await core?.startTrajectory({ trajectoryId: "traj-1" });
    });
    expect(
      screen
        .getByRole("button", { name: "Approve" })
        .parentElement?.getAttribute("data-tool-call-id"),
    ).toBe("tool-1");
    act(() => core?.stopTrajectory());
    expect(view.container.querySelector("[data-tool-call-id]")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" }).parentElement).toBe(
      screen.getByTestId("message"),
    );
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
