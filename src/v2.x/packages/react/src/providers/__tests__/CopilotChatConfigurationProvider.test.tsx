import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  CopilotChatConfigurationProvider,
  CopilotChatDefaultLabels,
  useCopilotChatConfiguration,
} from "../CopilotChatConfigurationProvider";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";
import { CopilotKitProvider } from "../CopilotKitProvider";
import { MockStepwiseAgent } from "@/__tests__/utils/test-helpers";
import { CopilotChat } from "../../components/chat/CopilotChat";

// Test component to access configuration
function ConfigurationDisplay() {
  const config = useCopilotChatConfiguration();
  return (
    <div>
      <div data-testid="agentId">{config?.agentId || "no-config"}</div>
      <div data-testid="threadId">{config?.threadId || "no-config"}</div>
      <div data-testid="placeholder">
        {config?.labels.chatInputPlaceholder || "no-config"}
      </div>
      <div data-testid="copyLabel">
        {config?.labels.assistantMessageToolbarCopyMessageLabel || "no-config"}
      </div>
    </div>
  );
}

describe("CopilotChatConfigurationProvider", () => {
  describe("Basic functionality", () => {
    it("should provide default configuration", () => {
      render(
        <CopilotChatConfigurationProvider threadId="test-thread">
          <ConfigurationDisplay />
        </CopilotChatConfigurationProvider>
      );

      expect(screen.getByTestId("agentId").textContent).toBe(DEFAULT_AGENT_ID);
      expect(screen.getByTestId("threadId").textContent).toBe("test-thread");
      expect(screen.getByTestId("placeholder").textContent).toBe(
        CopilotChatDefaultLabels.chatInputPlaceholder
      );
    });

    it("should accept custom agentId", () => {
      render(
        <CopilotChatConfigurationProvider
          threadId="test-thread"
          agentId="custom-agent"
        >
          <ConfigurationDisplay />
        </CopilotChatConfigurationProvider>
      );

      expect(screen.getByTestId("agentId").textContent).toBe("custom-agent");
    });

    it("should merge custom labels with defaults", () => {
      const customLabels = {
        chatInputPlaceholder: "Custom placeholder",
      };

      render(
        <CopilotChatConfigurationProvider
          threadId="test-thread"
          labels={customLabels}
        >
          <ConfigurationDisplay />
        </CopilotChatConfigurationProvider>
      );

      expect(screen.getByTestId("placeholder").textContent).toBe(
        "Custom placeholder"
      );
      // Other labels should still have defaults
      expect(screen.getByTestId("copyLabel").textContent).toBe(
        CopilotChatDefaultLabels.assistantMessageToolbarCopyMessageLabel
      );
    });
  });

  describe("Hook behavior", () => {
    it("should return null when no provider exists", () => {
      render(<ConfigurationDisplay />);

      expect(screen.getByTestId("agentId").textContent).toBe("no-config");
      expect(screen.getByTestId("threadId").textContent).toBe("no-config");
      expect(screen.getByTestId("placeholder").textContent).toBe("no-config");
    });
  });

  describe("CopilotChat priority merging", () => {
    it("should use defaults when no provider exists and no props passed", () => {
      // CopilotChat creates its own provider, so we need to check inside it
      // We'll check the input placeholder which uses the configuration
      const { container } = render(
        <CopilotKitProvider agents__unsafe_dev_only={{ [DEFAULT_AGENT_ID]: new MockStepwiseAgent() }}>
          <CopilotChat />
        </CopilotKitProvider>
      );

      // Find the input element and check its placeholder
      const input = container.querySelector('textarea, input[type="text"]');
      expect(input?.getAttribute("placeholder")).toBe(
        CopilotChatDefaultLabels.chatInputPlaceholder
      );
    });

    it("should inherit from existing provider when CopilotChat has no props", () => {
      const { container } = render(
        <CopilotKitProvider agents__unsafe_dev_only={{ "outer-agent": new MockStepwiseAgent({ agentId: "outer-agent" }) }}>
          <CopilotChatConfigurationProvider
            threadId="outer-thread"
            agentId="outer-agent"
            labels={{ chatInputPlaceholder: "Outer placeholder" }}
          >
            <CopilotChat />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      );

      // Check that the input inherits the outer placeholder
      const input = container.querySelector('textarea, input[type="text"]');
      expect(input?.getAttribute("placeholder")).toBe("Outer placeholder");
    });

    it("should override existing provider with CopilotChat props", () => {
      const { container } = render(
        <CopilotKitProvider agents__unsafe_dev_only={{ "inner-agent": new MockStepwiseAgent({ agentId: "inner-agent" }) }}>
          <CopilotChatConfigurationProvider
            threadId="outer-thread"
            agentId="outer-agent"
            labels={{ chatInputPlaceholder: "Outer placeholder" }}
          >
            <CopilotChat
              agentId="inner-agent"
              threadId="inner-thread"
              labels={{ chatInputPlaceholder: "Inner placeholder" }}
            />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      );

      // CopilotChat props should win - check the input placeholder
      const input = container.querySelector('textarea, input[type="text"]');
      expect(input?.getAttribute("placeholder")).toBe("Inner placeholder");
    });

    it("should merge labels correctly with priority: default < existing < props", () => {
      const { container } = render(
        <CopilotKitProvider agents__unsafe_dev_only={{ [DEFAULT_AGENT_ID]: new MockStepwiseAgent() }}>
          <CopilotChatConfigurationProvider
            threadId="outer-thread"
            labels={{
              chatInputPlaceholder: "Outer placeholder",
              assistantMessageToolbarCopyMessageLabel: "Outer copy",
            }}
          >
            <CopilotChat
              labels={{
                chatInputPlaceholder: "Inner placeholder",
                // Not overriding copyLabel, should inherit from outer
              }}
            />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      );

      const input = container.querySelector('textarea, input[type="text"]');
      expect(input?.getAttribute("placeholder")).toBe("Inner placeholder");
      // The copy label would be tested if we had assistant messages
    });

    it("should handle partial overrides correctly", () => {
      const { container } = render(
        <CopilotKitProvider agents__unsafe_dev_only={{ "outer-agent": new MockStepwiseAgent({ agentId: "outer-agent" }) }}>
          <CopilotChatConfigurationProvider
            threadId="outer-thread"
            agentId="outer-agent"
            labels={{ chatInputPlaceholder: "Outer placeholder" }}
          >
            <CopilotChat
              // Only override threadId and some labels, not agentId
              threadId="inner-thread"
              labels={{
                chatInputPlaceholder: "Inner placeholder",
              }}
            />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      );

      // Check the placeholder was overridden
      const input = container.querySelector('textarea, input[type="text"]');
      expect(input?.getAttribute("placeholder")).toBe("Inner placeholder");
      // agentId and other properties would be tested through agent behavior
    });

    it("should allow accessing configuration outside CopilotChat in same provider", () => {
      // This shows that ConfigurationDisplay outside CopilotChat
      // sees the outer provider values, not the inner merged ones
      render(
        <CopilotKitProvider agents__unsafe_dev_only={{ "outer-agent": new MockStepwiseAgent({ agentId: "outer-agent" }) }}>
          <CopilotChatConfigurationProvider
            threadId="outer-thread"
            agentId="outer-agent"
            labels={{ chatInputPlaceholder: "Outer placeholder" }}
          >
            <CopilotChat
              threadId="inner-thread"
              labels={{ chatInputPlaceholder: "Inner placeholder" }}
            />
            <ConfigurationDisplay />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      );

      // ConfigurationDisplay is outside CopilotChat, so it sees outer values
      expect(screen.getByTestId("agentId").textContent).toBe("outer-agent");
      expect(screen.getByTestId("threadId").textContent).toBe("outer-thread");
      expect(screen.getByTestId("placeholder").textContent).toBe("Outer placeholder");
    });
  });

  describe("Nested providers", () => {
    it("should handle multiple nested providers correctly", () => {
      render(
        <CopilotChatConfigurationProvider
          threadId="outer-thread"
          agentId="outer-agent"
          labels={{ chatInputPlaceholder: "Outer" }}
        >
          <CopilotChatConfigurationProvider
            threadId="middle-thread"
            agentId="middle-agent"
            labels={{ chatInputPlaceholder: "Middle" }}
          >
            <CopilotChatConfigurationProvider
              threadId="inner-thread"
              agentId="inner-agent"
              labels={{ chatInputPlaceholder: "Inner" }}
            >
              <ConfigurationDisplay />
            </CopilotChatConfigurationProvider>
          </CopilotChatConfigurationProvider>
        </CopilotChatConfigurationProvider>
      );

      // Innermost provider should win
      expect(screen.getByTestId("agentId").textContent).toBe("inner-agent");
      expect(screen.getByTestId("threadId").textContent).toBe("inner-thread");
      expect(screen.getByTestId("placeholder").textContent).toBe("Inner");
    });
  });
});
