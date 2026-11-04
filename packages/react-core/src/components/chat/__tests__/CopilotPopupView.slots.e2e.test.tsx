import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi } from "vitest";
import { CopilotPopupView } from "../CopilotPopupView";
import type { CopilotPopupViewProps } from "../CopilotPopupView";
import type { CopilotModalHeader } from "../CopilotModalHeader";
import type { CopilotChatToggleButtonProps } from "../CopilotChatToggleButton";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { stylesheet } from "@copilotkit/core/styles";

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

function renderPopup(props: Partial<CopilotPopupViewProps> = {}) {
  return render(
    <TestWrapper>
      <CopilotPopupView messages={sampleMessages} {...props} />
    </TestWrapper>,
  );
}

const header = () => screen.getByTestId("copilot-modal-header");
const popup = () => screen.getByTestId("copilot-popup");

// The header's own sub-slots are covered in CopilotModalHeader.slots.e2e and
// the chat view slots in CopilotChatView.slots.e2e. These tests pin that the
// popup forwards them.
describe("CopilotPopupView Slot System E2E Tests", () => {
  describe("1. Header Slot", () => {
    it("should apply tailwind class string to header", () => {
      renderPopup({ header: "bg-indigo-500 text-white shadow-lg" });

      expect(header()).toHaveClass(
        "cpk-modal-header",
        "bg-indigo-500",
        "text-white",
        "shadow-lg",
      );
    });

    it("should pass custom props to header", () => {
      const onClick = vi.fn();
      const headerProps: Partial<
        React.ComponentProps<typeof CopilotModalHeader>
      > & { "data-testid": string } = {
        "data-testid": "custom-popup-header",
        onClick,
      };
      renderPopup({ header: headerProps });

      fireEvent.click(screen.getByTestId("custom-popup-header"));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("passes title and header sub-slots through the header props object", () => {
      renderPopup({
        header: {
          title: "Chat Popup",
          titleContent: "text-lg italic",
          closeButton: "popup-close-btn",
        },
      });

      expect(screen.getByTestId("copilot-header-title")).toHaveTextContent(
        "Chat Popup",
      );
      expect(screen.getByTestId("copilot-header-title")).toHaveClass(
        "text-lg",
        "italic",
      );
      expect(screen.getByTestId("copilot-close-button")).toHaveClass(
        "popup-close-btn",
      );
    });

    it("should allow custom component for header", () => {
      const CustomHeader: React.FC = () => (
        <header data-testid="custom-popup-header-component">
          <span>AI Assistant</span>
        </header>
      );

      renderPopup({ header: CustomHeader });

      expect(
        within(popup()).getByTestId("custom-popup-header-component"),
      ).toHaveTextContent("AI Assistant");
      expect(screen.queryByTestId("copilot-modal-header")).toBeNull();
    });
  });

  describe("2. Inherited CopilotChatView Slots", () => {
    it("forwards chat view slots to the chat view", () => {
      const { container } = renderPopup({
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

    it("should apply className to the chat view", () => {
      renderPopup({ className: "custom-popup-class" });

      expect(screen.getByTestId("copilot-chat")).toHaveClass(
        "cpk-popup-view-chat-view",
        "custom-popup-class",
      );
    });
  });

  describe("3. Popup-specific Props", () => {
    it("sets numeric width and height as CSS variables", () => {
      renderPopup({ width: 500, height: 700 });

      expect(popup().style.getPropertyValue("--copilot-popup-width")).toBe(
        "500px",
      );
      expect(popup().style.getPropertyValue("--copilot-popup-height")).toBe(
        "700px",
      );
    });

    it("should support string dimensions", () => {
      renderPopup({ width: "80vw", height: "90vh" });

      expect(popup().style.getPropertyValue("--copilot-popup-width")).toBe(
        "80vw",
      );
      expect(popup().style.getPropertyValue("--copilot-popup-height")).toBe(
        "90vh",
      );
    });

    it("stays open when the user clicks into a chat popover", () => {
      render(
        <TestWrapper>
          <CopilotPopupView
            messages={sampleMessages}
            defaultOpen={true}
            clickOutsideToClose={true}
          />
          <div data-copilotkit-popover>
            <input aria-label="Comment" />
          </div>
          <div data-slot="popover-content">
            <button type="button">App popover</button>
          </div>
        </TestWrapper>,
      );
      const isOpen = () =>
        popup().classList.contains("cpk-popup-view-window-open");
      expect(isOpen()).toBe(true);

      fireEvent.pointerDown(screen.getByRole("textbox", { name: "Comment" }));
      expect(isOpen()).toBe(true);

      // The app's own popovers are outside the chat.
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "App popover" }),
      );
      expect(isOpen()).toBe(false);
    });
  });

  describe("4. Integration Tests", () => {
    it("keeps the transparent-background utility on the positioning wrapper", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView messages={sampleMessages} defaultOpen={true} />
        </TestWrapper>,
      );

      const popupEl = container.querySelector("[data-copilot-popup]");
      const positioningWrapper = popupEl?.parentElement;

      expect(positioningWrapper?.hasAttribute("data-copilotkit")).toBe(true);
      // jsdom does not load the stylesheet, so check the class and its rule.
      // The wrapper must override base.css's [data-copilotkit] background.
      expect(positioningWrapper?.classList.contains("cpk-popup-view")).toBe(
        true,
      );
      expect(stylesheet).toMatch(
        /:where\(\.cpk-popup-view\)\{[^}]*background-color:transparent/,
      );
    });

    it("should render the header and messages when open", () => {
      renderPopup({ defaultOpen: true });

      expect(within(popup()).getByTestId("copilot-modal-header")).toBeVisible();
      expect(popup()).toHaveTextContent("Hello");
      expect(popup()).toHaveTextContent("Hi there!");
    });

    it("should not render popup content when closed", () => {
      // Render without the outer CopilotChatConfigurationProvider so the
      // PopupView's own provider (with defaultOpen=false) isn't overridden
      // by a parent whose isModalOpen defaults to true.
      const { container } = render(
        <CopilotKitProvider>
          <CopilotPopupView messages={sampleMessages} defaultOpen={false} />
        </CopilotKitProvider>,
      );

      expect(container.querySelector("[data-copilot-popup]")).toBeNull();
    });
  });

  describe("5. Toggle Button Slot", () => {
    it("should apply tailwind class string to toggle button", () => {
      renderPopup({ toggleButton: "bg-purple-500 hover:bg-purple-600" });

      expect(screen.getByTestId("copilot-chat-toggle")).toHaveClass(
        "cpk-chat-toggle-button",
        "bg-purple-500",
        "hover:bg-purple-600",
      );
    });

    it("should pass custom props to toggle button", () => {
      const toggleButtonProps: Partial<CopilotChatToggleButtonProps> & {
        "data-testid": string;
      } = { "data-testid": "popup-custom-toggle", disabled: true };

      renderPopup({ toggleButton: toggleButtonProps });

      expect(screen.getByTestId("popup-custom-toggle")).toBeDisabled();
    });

    it("should pass openIcon and closeIcon sub-slot props", () => {
      const { container } = renderPopup({
        toggleButton: {
          openIcon: "text-blue-500",
          closeIcon: "text-orange-500",
        },
      });

      expect(
        container.querySelector(
          '[data-slot="chat-toggle-button-open-icon"] .text-blue-500',
        ),
      ).not.toBeNull();
      expect(
        container.querySelector(
          '[data-slot="chat-toggle-button-close-icon"] .text-orange-500',
        ),
      ).not.toBeNull();
    });

    it("should allow custom component for toggle button", () => {
      const CustomToggleButton: React.FC = () => (
        <button data-testid="popup-custom-toggle-component">Open Chat</button>
      );

      renderPopup({ toggleButton: CustomToggleButton });

      expect(
        screen.getByTestId("popup-custom-toggle-component"),
      ).toHaveTextContent("Open Chat");
      expect(screen.queryByTestId("copilot-chat-toggle")).toBeNull();
    });
  });
});
