import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { CopilotListeners } from "../CopilotListeners";
import { CopilotKitProvider } from "../../v2/providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../v2/providers/CopilotChatConfigurationProvider";
import { ToastProvider } from "../toast/toast-provider";

/**
 * Regression test for #3249: CopilotListeners throws when no agents registered.
 *
 * When CopilotKitProvider has no agents registered (empty agents map) and no
 * runtimeUrl, useAgent() inside CopilotListeners throws. The component should
 * handle this gracefully and render null without crashing.
 */
describe("CopilotListeners (#3249)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("does not throw when no agents are registered", () => {
    // No agents, no runtimeUrl - should not crash
    expect(() => {
      render(
        <ToastProvider enabled={false}>
          <CopilotKitProvider>
            <CopilotChatConfigurationProvider
              agentId="default"
              threadId="test-thread"
            >
              <CopilotListeners />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        </ToastProvider>,
      );
    }).not.toThrow();
  });
});
