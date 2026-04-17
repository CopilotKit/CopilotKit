import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { RegistryReader } from "../registry-reader";
import type { CapturedRegistry } from "../registry";

function Host() {
  useCopilotAction({
    name: "testAction",
    description: "d",
    parameters: [],
    // `available: "frontend"` routes this through V1's `useRenderToolCall`
    // (the only valid path for a render-only action in current react-core).
    // Without `available` AND without `handler`, `getActionConfig` throws
    // "Invalid action configuration".
    available: "frontend",
    render: () => <div data-testid="r">hi</div>,
  });
  return null;
}

describe("RegistryReader inside real CopilotKit", () => {
  it("captures the registered action config", async () => {
    const onCapture = vi.fn();
    render(
      <CopilotKit runtimeUrl="https://mock.local/api">
        <RegistryReader onCapture={onCapture} />
        <Host />
      </CopilotKit>,
    );

    // The reader fires an immediate capture + a setTimeout(0) deferred one to
    // pick up registrations from sibling effects. Wait until the deferred
    // capture actually contains our action rather than spinning on a fixed
    // timeout (which is flaky under slow CI).
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
});
