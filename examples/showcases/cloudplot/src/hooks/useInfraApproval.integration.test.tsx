// @vitest-environment jsdom

import type { ReactElement } from "react";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider, useCopilotKit } from "@copilotkit/react-core/v2";

import { useInfraApproval } from "./useInfraApproval";

type CopilotKitCore = ReturnType<typeof useCopilotKit>["copilotkit"];

function registeredCore(current: CopilotKitCore | null): CopilotKitCore {
  if (!current) throw new Error("CopilotKit core was not captured");
  return current;
}

const args = {
  action: "Simulate deploying the architecture",
  resources: ["web-server", "database"],
  cost_impact: "+$42.00/mo",
  risk_level: "high",
};

describe("useInfraApproval V2 integration", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    ["Approve", "approved"],
    ["Reject", "rejected"],
  ])(
    "resolves the registered tool with the %s decision",
    async (label, decision) => {
      let core: CopilotKitCore | null = null;
      vi.spyOn(console, "warn").mockImplementation(() => undefined);

      function Harness() {
        core = useCopilotKit().copilotkit;
        useInfraApproval();
        return null;
      }

      render(
        <CopilotKitProvider>
          <Harness />
        </CopilotKitProvider>,
      );

      await waitFor(() =>
        expect(
          registeredCore(core).getTool({ toolName: "approveDeployment" }),
        ).toBeDefined(),
      );

      const tool = registeredCore(core).getTool({
        toolName: "approveDeployment",
      });
      const renderer = registeredCore(core).renderToolCalls.find(
        (candidate) => candidate.name === "approveDeployment",
      );
      if (!tool?.handler || !renderer) {
        throw new Error("approveDeployment was not fully registered");
      }
      expect(tool.followUp).not.toBe(false);

      const result = Reflect.apply(tool.handler, undefined, [args]);
      const renderToolCall = renderer.render as (props: {
        name: string;
        toolCallId: string;
        args: typeof args;
        status: "executing";
        result: undefined;
      }) => ReactElement;

      render(
        renderToolCall({
          name: "approveDeployment",
          toolCallId: "approval-1",
          args,
          status: "executing",
          result: undefined,
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: label }));

      await expect(result).resolves.toBe(decision);
    },
  );
});
