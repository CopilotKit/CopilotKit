// @vitest-environment jsdom

import type { ReactElement } from "react";

import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHumanInTheLoop } from "@copilotkit/react-core/v2";

import { useInfraApproval } from "./useInfraApproval";

vi.mock("@copilotkit/react-core/v2", () => ({
  useHumanInTheLoop: vi.fn(),
}));

type ApprovalRenderer = {
  name: string;
  render: (props: {
    args: {
      action?: string;
      resources?: string[];
      cost_impact?: string;
      risk_level?: "low" | "medium" | "high";
    };
    status: "inProgress" | "executing" | "complete";
    respond?: (result: unknown) => Promise<void>;
  }) => ReactElement;
};

function registeredApproval(): ApprovalRenderer {
  const registration = vi.mocked(useHumanInTheLoop).mock.calls[0]?.[0];
  if (!registration || typeof registration.render !== "function") {
    throw new Error("Missing approveDeployment HITL registration");
  }
  return registration as ApprovalRenderer;
}

const args = {
  action: "Simulate deploying the architecture",
  resources: ["web-server", "database"],
  cost_impact: "+$42.00/mo",
  risk_level: "high" as const,
};

describe("useInfraApproval", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("renders preparing, decision, and completed states", () => {
    renderHook(() => useInfraApproval());
    const approval = registeredApproval();
    expect(approval.name).toBe("approveDeployment");

    const view = render(approval.render({ args: {}, status: "inProgress" }));
    expect(screen.getByText("Preparing approval request...")).toBeTruthy();

    view.rerender(
      approval.render({ args, status: "executing", respond: vi.fn() }),
    );
    expect(screen.getByText("Approval Required")).toBeTruthy();
    expect(
      screen.getByText("Simulation only — no AWS resources will be created."),
    ).toBeTruthy();

    view.rerender(approval.render({ args, status: "complete" }));
    expect(screen.getByText("Deployment decision processed")).toBeTruthy();
  });

  it.each([
    ["Approve", "approved"],
    ["Reject", "rejected"],
  ])(
    "returns %s as the tool result that resumes the run",
    async (label, decision) => {
      const respond = vi.fn(async () => undefined);
      renderHook(() => useInfraApproval());

      render(
        registeredApproval().render({
          args,
          status: "executing",
          respond,
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: label }));

      expect(respond).toHaveBeenCalledOnce();
      expect(respond).toHaveBeenCalledWith(decision);
    },
  );
});
