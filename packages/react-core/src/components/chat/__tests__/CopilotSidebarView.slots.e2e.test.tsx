import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi } from "vitest";
import { CopilotSidebarView } from "../CopilotSidebarView";
import type { CopilotSidebarViewProps } from "../CopilotSidebarView";
import type { CopilotModalHeader } from "../CopilotModalHeader";
import type { CopilotChatToggleButtonProps } from "../CopilotChatToggleButton";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";

// Wrapper to provide required context
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      {children}
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

const sampleMessages = [
  { id: "1", role: "user" as const, content: "Hello" },
  { id: "2", role: "assistant" as const, content: "Hi there!" },
];

function renderSidebar(props: Partial<CopilotSidebarViewProps> = {}) {
  return render(
    <TestWrapper>
      <CopilotSidebarView messages={sampleMessages} {...props} />
    </TestWrapper>,
  );
}

const header = () => screen.getByTestId("copilot-modal-header");
const sidebar = () => screen.getByTestId("copilot-sidebar");

// The header's own sub-slots are covered in CopilotModalHeader.slots.e2e and
// the chat view slots in CopilotChatView.slots.e2e. These tests pin that the
// sidebar forwards them.
describe("CopilotSidebarView Slot System E2E Tests", () => {
  describe("1. Header Slot", () => {
    it("should apply tailwind class string to header", () => {
      renderSidebar({ header: "bg-gradient-to-r from-blue-500 to-purple-500" });

      expect(header()).toHaveClass(
        "cpk-modal-header",
        "bg-gradient-to-r",
        "from-blue-500",
      );
    });

    it("should pass custom props to header", () => {
      const onClick = vi.fn();
      const headerProps: Partial<
        React.ComponentProps<typeof CopilotModalHeader>
      > & { "data-testid": string } = {
        "data-testid": "custom-sidebar-header",
        onClick,
      };
      renderSidebar({ header: headerProps });

      fireEvent.click(screen.getByTestId("custom-sidebar-header"));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("passes title and header sub-slots through the header props object", () => {
      renderSidebar({
        header: {
          title: "AI Assistant",
          titleContent: "text-xl font-semibold",
          closeButton: "sidebar-close-btn",
        },
      });

      expect(screen.getByTestId("copilot-header-title")).toHaveTextContent(
        "AI Assistant",
      );
      expect(screen.getByTestId("copilot-header-title")).toHaveClass(
        "text-xl",
        "font-semibold",
      );
      expect(screen.getByTestId("copilot-close-button")).toHaveClass(
        "sidebar-close-btn",
      );
    });

    it("should allow custom component for header", () => {
      const CustomHeader: React.FC = () => (
        <header data-testid="custom-header-component">
          <span>My Custom Header</span>
        </header>
      );

      renderSidebar({ header: CustomHeader });

      expect(
        within(sidebar()).getByTestId("custom-header-component"),
      ).toHaveTextContent("My Custom Header");
      expect(screen.queryByTestId("copilot-modal-header")).toBeNull();
    });
  });

  describe("2. Inherited CopilotChatView Slots", () => {
    it("forwards chat view slots to the chat view", () => {
      const { container } = renderSidebar({
        messageView: "message-style",
        input: "input-style",
      });

      expect(
        container.querySelector("[data-testid=copilot-message-list]"),
      ).toHaveClass("message-style");
      expect(container.querySelector(".cpk-chat-input")).toHaveClass(
        "input-style",
      );
    });
  });

  describe("3. Sidebar-specific Props", () => {
    it("should support custom width prop", () => {
      renderSidebar({ width: 600 });

      expect(sidebar().style.getPropertyValue("--sidebar-width")).toBe("600px");
    });

    it("should support string width prop", () => {
      renderSidebar({ width: "50vw" });

      expect(sidebar().style.getPropertyValue("--sidebar-width")).toBe("50vw");
    });
  });

  describe("4. Integration Tests", () => {
    it("should render the header and messages", () => {
      renderSidebar();

      expect(
        within(sidebar()).getByTestId("copilot-modal-header"),
      ).toBeInTheDocument();
      expect(sidebar()).toHaveTextContent("Hello");
      expect(sidebar()).toHaveTextContent("Hi there!");
    });
  });

  describe("5. Toggle Button Slot", () => {
    it("should apply tailwind class string to toggle button", () => {
      renderSidebar({ toggleButton: "bg-emerald-500 hover:bg-emerald-600" });

      expect(screen.getByTestId("copilot-chat-toggle")).toHaveClass(
        "cpk-chat-toggle-button",
        "bg-emerald-500",
        "hover:bg-emerald-600",
      );
    });

    it("should pass custom props to toggle button", () => {
      const toggleButtonProps: Partial<CopilotChatToggleButtonProps> & {
        "data-testid": string;
      } = { "data-testid": "custom-toggle", disabled: true };

      renderSidebar({ toggleButton: toggleButtonProps });

      expect(screen.getByTestId("custom-toggle")).toBeDisabled();
    });

    it("should pass openIcon and closeIcon sub-slot props", () => {
      const { container } = renderSidebar({
        toggleButton: {
          openIcon: "text-yellow-500",
          closeIcon: "text-red-500",
        },
      });

      expect(
        container.querySelector(
          '[data-slot="chat-toggle-button-open-icon"] .text-yellow-500',
        ),
      ).not.toBeNull();
      expect(
        container.querySelector(
          '[data-slot="chat-toggle-button-close-icon"] .text-red-500',
        ),
      ).not.toBeNull();
    });

    it("should allow custom component for toggle button", () => {
      const CustomToggleButton: React.FC = () => (
        <button data-testid="custom-toggle-component">Chat</button>
      );

      renderSidebar({ toggleButton: CustomToggleButton });

      expect(screen.getByTestId("custom-toggle-component")).toHaveTextContent(
        "Chat",
      );
      expect(screen.queryByTestId("copilot-chat-toggle")).toBeNull();
    });
  });
});
