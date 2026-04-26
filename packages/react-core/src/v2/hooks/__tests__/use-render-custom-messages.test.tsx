import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "../../../test-helpers/render-hook";
import { useRenderCustomMessages } from "../use-render-custom-messages";
import { CopilotKitProvider } from "../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../providers/CopilotChatConfigurationProvider";

/**
 * Regression test for #3497: useRenderCustomMessages throws "Agent not found"
 * when the agent is undefined during the connecting state.
 *
 * During initial connection, the agent may not yet be registered in the
 * CopilotKit registry. The hook should return null gracefully instead of
 * throwing an error.
 */
describe("useRenderCustomMessages (#3497)", () => {
  it("returns null instead of throwing when agent is not found", () => {
    // Render the hook inside a CopilotKitProvider with an agentId that
    // does NOT exist in the registry (simulating connecting state).
    // The hook should not throw.
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CopilotKitProvider
        renderCustomMessages={[
          {
            agentId: "nonexistent-agent",
            render: () => <div>Custom</div>,
          },
        ]}
      >
        <CopilotChatConfigurationProvider
          agentId="nonexistent-agent"
          threadId="test-thread"
        >
          {children}
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );

    const { result } = renderHook(() => useRenderCustomMessages(), { wrapper });

    // The hook should return a function (the render function), not throw
    // When called, it should handle missing agent gracefully
    if (typeof result.current === "function") {
      const output = result.current({
        message: { id: "msg-1", role: "assistant", content: "test" },
        position: "after",
      });
      // Should return null since agent isn't found
      expect(output).toBeNull();
    } else {
      // If result.current is null, that's also acceptable
      expect(result.current).toBeNull();
    }
  });
});
