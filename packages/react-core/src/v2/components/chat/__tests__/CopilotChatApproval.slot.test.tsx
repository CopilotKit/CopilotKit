import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotApprovalController } from "../../../hooks/use-copilot-approval";
import { CopilotChatView } from "../CopilotChatView";

const request = {
  description: "Review these exact changes",
  agentId: "logistics",
  threadId: "thread-1",
};

describe("CopilotChat approval slot", () => {
  it("shows a nonmodal default card and ignores synthetic approval", async () => {
    const controller = new CopilotApprovalController();
    render(
      <CopilotKitProvider>
        <CopilotChatView
          messages={[]}
          welcomeScreen={false}
          approvalController={controller}
          approvalAgentId="logistics"
        />
      </CopilotKitProvider>,
    );
    act(() => {
      void controller.request(request);
    });
    expect(screen.getByTestId("copilot-approval").textContent).toContain(
      request.description,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(controller.getSnapshot()).toEqual(request);
    act(() => controller.cancel());
    expect(screen.queryByTestId("copilot-approval")).toBeNull();
  });

  it("lets the consumer replace the card while preserving the decision API", () => {
    const controller = new CopilotApprovalController();
    render(
      <CopilotKitProvider>
        <CopilotChatView
          messages={[]}
          welcomeScreen={false}
          approvalController={controller}
          approvalAgentId="logistics"
          approval={({ request }) => (
            <div data-testid="custom-approval">{request.description}</div>
          )}
        />
      </CopilotKitProvider>,
    );
    act(() => {
      void controller.request(request);
    });
    expect(screen.getByTestId("custom-approval").textContent).toBe(
      request.description,
    );
    expect(screen.queryByTestId("copilot-approval")).toBeNull();
    act(() => controller.cancel());
  });

  it("renders a replaceable nonmodal status notice without an approval action", () => {
    render(
      <CopilotKitProvider>
        <CopilotChatView
          messages={[]}
          welcomeScreen={false}
          statusNotice={{ message: "Outcome unconfirmed" }}
          notice={({ message }) => (
            <div data-testid="custom-notice">{message}</div>
          )}
        />
      </CopilotKitProvider>,
    );
    expect(screen.getByTestId("custom-notice").textContent).toBe(
      "Outcome unconfirmed",
    );
    expect(screen.queryByTestId("copilot-approval")).toBeNull();
  });
});
