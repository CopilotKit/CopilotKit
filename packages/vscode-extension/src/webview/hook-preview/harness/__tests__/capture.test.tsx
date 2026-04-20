import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { RegistryReader, buildRegistry } from "../registry-reader";
import { createCopilotkitStubs } from "../../copilotkit-stubs";
import type { CapturedRegistry } from "../registry";

// Reproduces what `executeBundle` does at runtime: installs the stub
// object whose captured side effects feed into RegistryReader.
function installStubs() {
  (window as unknown as { __copilotkit_captured?: unknown[] })
    .__copilotkit_captured = [];
  return createCopilotkitStubs() as Record<string, (config: unknown) => void>;
}

describe("RegistryReader (stub-based capture)", () => {
  beforeEach(() => {
    delete (window as unknown as { __copilotkit_captured?: unknown[] })
      .__copilotkit_captured;
  });

  it("captures useCopilotAction into renderToolCalls", async () => {
    const stubs = installStubs();
    function Host() {
      stubs.useCopilotAction({
        name: "testAction",
        description: "d",
        parameters: [],
        available: "frontend",
        render: () => null,
      });
      return null;
    }
    const onCapture = vi.fn();
    render(
      <>
        <Host />
        <RegistryReader onCapture={onCapture} />
      </>,
    );
    await waitFor(() => {
      const latest: CapturedRegistry | undefined =
        onCapture.mock.calls.at(-1)?.[0];
      const found = latest?.renderToolCalls?.find(
        (r) => r.name === "testAction",
      );
      expect(found).toBeDefined();
      expect(typeof (found as { render?: unknown }).render).toBe("function");
    });
  });

  it("buildRegistry splits hook calls into the correct slots", () => {
    const reg = buildRegistry([
      {
        hook: "useCopilotAction",
        config: { name: "a", render: () => null },
      },
      {
        hook: "useCoAgentStateRender",
        config: { name: "agent1", render: () => null },
      },
      {
        hook: "useRenderTool",
        config: { name: "tool1", render: () => null },
      },
      {
        hook: "useLangGraphInterrupt",
        config: { render: () => null },
      },
    ]);
    expect(reg.renderToolCalls.map((r) => r.name)).toEqual([
      "a",
      "tool1",
      "__useLangGraphInterrupt__",
    ]);
    expect(reg.coAgentStateRenders.map((c) => c.name)).toEqual(["agent1"]);
  });
});
