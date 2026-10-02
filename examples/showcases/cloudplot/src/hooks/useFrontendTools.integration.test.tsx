// @vitest-environment jsdom

import type { ReactElement } from "react";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitProvider, useCopilotKit } from "@copilotkit/react-core/v2";

import { useFrontendTools } from "./useFrontendTools";

type CopilotKitCore = ReturnType<typeof useCopilotKit>["copilotkit"];

function registeredCore(current: CopilotKitCore | null): CopilotKitCore {
  if (!current) throw new Error("CopilotKit core was not captured");
  return current;
}

describe("useFrontendTools V2 integration", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("registers and renders a backend tool call without advertising a duplicate frontend tool", async () => {
    let core: CopilotKitCore | null = null;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    function Harness() {
      core = useCopilotKit().copilotkit;
      useFrontendTools();
      return null;
    }

    render(
      <CopilotKitProvider>
        <Harness />
      </CopilotKitProvider>,
    );

    await waitFor(() =>
      expect(
        registeredCore(core).renderToolCalls.some(
          (renderer) => renderer.name === "add_resource",
        ),
      ).toBe(true),
    );
    expect(
      registeredCore(core).tools.some((tool) => tool.name === "add_resource"),
    ).toBe(false);

    const renderer = registeredCore(core).renderToolCalls.find(
      (candidate) => candidate.name === "add_resource",
    );
    if (!renderer) throw new Error("add_resource renderer was not registered");
    const renderToolCall = renderer.render as (props: {
      name: string;
      toolCallId: string;
      args: { resource_type: string; name: string };
      status: "complete";
      result: string;
    }) => ReactElement;

    render(
      renderToolCall({
        name: "add_resource",
        toolCallId: "add-1",
        args: { resource_type: "ec2", name: "primary-web" },
        status: "complete",
        result: '{"id":"ec2-primary"}',
      }),
    );

    expect(screen.getByText("ec2")).toBeTruthy();
    expect(screen.getByText("primary-web")).toBeTruthy();
  });
});
