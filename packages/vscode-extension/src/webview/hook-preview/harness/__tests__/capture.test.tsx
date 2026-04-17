import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { CopilotKit, useCopilotAction } from "@copilotkit/react-core";
import { RegistryReader } from "../registry-reader";

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
    await act(async () => {
      render(
        <CopilotKit runtimeUrl="https://mock.local/api">
          <RegistryReader onCapture={onCapture} />
          <Host />
        </CopilotKit>,
      );
    });
    // Give the reader's deferred `setTimeout(0)` capture a chance to fire
    // after all sibling host effects (including V1 `useRenderToolCall`'s
    // registration effect) have flushed.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(onCapture).toHaveBeenCalled();
    const payload = onCapture.mock.calls.at(-1)![0];
    const actions = payload.v1.actions;
    expect(actions).toBeDefined();
    const stored = Object.values(actions).find(
      (a: any) => a?.name === "testAction",
    );
    expect(stored).toBeDefined();
    expect(typeof (stored as any).render).toBe("function");
  });
});
