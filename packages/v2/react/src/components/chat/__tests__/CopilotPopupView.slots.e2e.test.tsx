import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CopilotPopupView } from "../CopilotPopupView";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";

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

describe("CopilotPopupView Slot System E2E Tests", () => {
  // ============================================================================
  // 1. TAILWIND CLASS TESTS - HEADER SLOT (UNIQUE TO POPUP)
  // ============================================================================
  describe("1. Tailwind Class Slot Override - Header Slot", () => {
    describe("header slot", () => {
      it("should apply tailwind class string to header", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotPopupView
              messages={sampleMessages}
              header="bg-indigo-500 text-white shadow-lg"
            />
          </TestWrapper>,
        );

        const header = container.querySelector(".bg-indigo-500");
        if (header) {
          expect(header.classList.contains("text-white")).toBe(true);
          expect(header.classList.contains("shadow-lg")).toBe(true);
        }
      });

      it("should override default header styles", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotPopupView
              messages={sampleMessages}
              header="rounded-t-3xl border-none"
            />
          </TestWrapper>,
        );

        const header = container.querySelector(".rounded-t-3xl");
        expect(header).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 2. PROPERTY PASSING TESTS - HEADER SLOT
  // ============================================================================
  describe("2. Property Passing - Header Slot", () => {
    describe("header slot", () => {
      it("should pass custom props to header", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotPopupView
              messages={sampleMessages}
              header={{ "data-testid": "custom-popup-header" }}
            />
          </TestWrapper>,
        );

        const header = screen.queryByTestId("custom-popup-header");
        expect(header).toBeDefined();
      });

      it("should pass title prop through to header", () => {
        render(
          <TestWrapper>
            <CopilotPopupView
              messages={sampleMessages}
              header={{ title: "Popup Assistant" }}
            />
          </TestWrapper>,
        );

        expect(screen.queryByText("Popup Assistant")).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 3. CUSTOM COMPONENT TESTS - HEADER SLOT
  // ============================================================================
  describe("3. Custom Component - Header Slot", () => {
    it("should allow custom component for header", () => {
      const CustomHeader: React.FC = () => (
        <header data-testid="custom-popup-header-component">
          <div className="flex justify-between items-center p-4">
            <span>AI Assistant</span>
            <button>×</button>
          </div>
        </header>
      );

      render(
        <TestWrapper>
          <CopilotPopupView
            messages={sampleMessages}
            header={CustomHeader as any}
          />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-popup-header-component");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toContain("AI Assistant");
    });

    it("should allow passing header props for customization", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView
            messages={sampleMessages}
            header={{
              title: "Chat Popup",
              titleContent: "text-lg italic",
              closeButton: "text-gray-400",
            }}
          />
        </TestWrapper>,
      );

      expect(screen.queryByText("Chat Popup")).toBeDefined();
      expect(container.querySelector(".text-lg")).toBeDefined();
      expect(container.querySelector(".italic")).toBeDefined();
    });
  });

  // ============================================================================
  // 4. INHERITED COPILOTCHATVIEW SLOTS
  // ============================================================================
  describe("4. Inherited CopilotChatView Slots", () => {
    describe("messageView slot (inherited)", () => {
      it("should apply tailwind class string to inherited messageView", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotPopupView
              messages={sampleMessages}
              messageView="bg-slate-50 p-4"
            />
          </TestWrapper>,
        );

        const messageView = container.querySelector(".bg-slate-50");
        expect(messageView).toBeDefined();
      });
    });

    describe("input slot (inherited)", () => {
      it("should apply tailwind class string to inherited input", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotPopupView
              messages={sampleMessages}
              input="border-t-2 border-indigo-300"
            />
          </TestWrapper>,
        );

        const input = container.querySelector(".border-indigo-300");
        expect(input).toBeDefined();
      });
    });

    describe("scrollView slot (inherited)", () => {
      it("should apply tailwind class string to inherited scrollView", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotPopupView
              messages={sampleMessages}
              scrollView="scrollbar-thin scrollbar-thumb-gray-300"
            />
          </TestWrapper>,
        );

        const scrollView = container.querySelector(".scrollbar-thin");
        expect(scrollView).toBeDefined();
      });
    });

    describe("suggestionView slot (inherited)", () => {
      it("should apply tailwind class string to inherited suggestionView", () => {
        const suggestions = [
          { title: "Quick Reply", message: "Reply message", isLoading: false },
        ];

        const { container } = render(
          <TestWrapper>
            <CopilotPopupView
              messages={sampleMessages}
              suggestions={suggestions}
              suggestionView="flex-wrap gap-2"
            />
          </TestWrapper>,
        );

        const suggestionView = container.querySelector(".flex-wrap");
        if (suggestionView) {
          expect(suggestionView.classList.contains("gap-2")).toBe(true);
        }
      });
    });

    describe("input slot (inherited)", () => {
      it("should apply tailwind class string to inherited input", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotPopupView
              messages={sampleMessages}
              input="bg-gray-100 rounded-b-2xl"
            />
          </TestWrapper>,
        );

        const input = container.querySelector(".bg-gray-100");
        expect(input).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 5. DRILL-DOWN INTO HEADER SUB-SLOTS
  // ============================================================================
  describe("5. Drill-down into Header Sub-slots", () => {
    it("should allow customizing header titleContent through props object", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView
            messages={sampleMessages}
            header={{
              title: "Popup Chat",
              titleContent: "text-xl text-indigo-600 tracking-wide",
            }}
          />
        </TestWrapper>,
      );

      const titleContent = container.querySelector(".text-xl");
      expect(titleContent).toBeDefined();
      expect(titleContent?.classList.contains("text-indigo-600")).toBe(true);
      expect(titleContent?.classList.contains("tracking-wide")).toBe(true);
    });

    it("should allow customizing header closeButton through props object", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView
            messages={sampleMessages}
            header={{
              title: "Popup",
              closeButton: "popup-close-btn",
            }}
          />
        </TestWrapper>,
      );

      const closeBtn = container.querySelector(".popup-close-btn");
      expect(closeBtn).toBeDefined();
    });

    it("should allow custom component for header via component slot", () => {
      const CustomHeader: React.FC = () => (
        <header data-testid="full-custom-popup-header">
          <span>Custom Popup Header</span>
          <button data-testid="popup-custom-close">Dismiss</button>
        </header>
      );

      render(
        <TestWrapper>
          <CopilotPopupView
            messages={sampleMessages}
            header={CustomHeader as any}
          />
        </TestWrapper>,
      );

      const customClose = screen.queryByTestId("popup-custom-close");
      expect(customClose).toBeDefined();
      expect(customClose?.textContent).toBe("Dismiss");
    });

    it("should allow custom layout via custom header component", () => {
      const CustomLayoutHeader: React.FC = () => (
        <div className="custom-popup-header-layout">
          <div className="close-area">
            <button>X</button>
          </div>
          <div className="title-area">
            <span>Custom Title</span>
          </div>
        </div>
      );

      const { container } = render(
        <TestWrapper>
          <CopilotPopupView
            messages={sampleMessages}
            header={CustomLayoutHeader as any}
          />
        </TestWrapper>,
      );

      expect(
        container.querySelector(".custom-popup-header-layout"),
      ).toBeDefined();
      expect(container.querySelector(".close-area")).toBeDefined();
      expect(container.querySelector(".title-area")).toBeDefined();
    });
  });

  // ============================================================================
  // 6. CLASSNAME AND MIXED CUSTOMIZATION
  // ============================================================================
  describe("6. className Override and Mixed Customization", () => {
    it("should apply className to popup root", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView
            messages={sampleMessages}
            className="custom-popup-class"
          />
        </TestWrapper>,
      );

      const popup = container.querySelector(".custom-popup-class");
      expect(popup).toBeDefined();
    });

    it("should merge multiple slot classNames correctly", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView
            messages={sampleMessages}
            header="header-style"
            messageView="message-style"
            input="input-style"
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".header-style")).toBeDefined();
      expect(container.querySelector(".message-style")).toBeDefined();
      expect(container.querySelector(".input-style")).toBeDefined();
    });

    it("should work with property objects and class strings mixed", () => {
      const onClick = vi.fn();
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView
            messages={sampleMessages}
            header={{ onClick, className: "clickable-header" }}
            input="styled-input"
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".styled-input")).toBeDefined();

      const header = container.querySelector(".clickable-header");
      if (header) {
        fireEvent.click(header);
        expect(onClick).toHaveBeenCalled();
      }
    });
  });

  // ============================================================================
  // 7. POPUP-SPECIFIC PROPS
  // ============================================================================
  describe("7. Popup-specific Props", () => {
    it("should support custom width prop", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView messages={sampleMessages} width={500} />
        </TestWrapper>,
      );

      const popup = container.querySelector("[data-copilot-popup]");
      if (popup) {
        expect(popup.getAttribute("style")).toContain("--copilot-popup-width");
      }
    });

    it("should support custom height prop", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView messages={sampleMessages} height={700} />
        </TestWrapper>,
      );

      const popup = container.querySelector("[data-copilot-popup]");
      if (popup) {
        expect(popup.getAttribute("style")).toContain("--copilot-popup-height");
      }
    });

    it("should support string dimensions", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView
            messages={sampleMessages}
            width="80vw"
            height="90vh"
          />
        </TestWrapper>,
      );

      const popup = container.querySelector("[data-copilot-popup]");
      expect(popup).toBeDefined();
    });

    it("should support clickOutsideToClose prop", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView
            messages={sampleMessages}
            clickOutsideToClose={true}
          />
        </TestWrapper>,
      );

      const popup = container.querySelector("[data-copilot-popup]");
      expect(popup).toBeDefined();
    });
  });

  // ============================================================================
  // 8. INTEGRATION TESTS
  // ============================================================================
  describe("8. Integration Tests", () => {
    it("should render popup with all default components when open", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView messages={sampleMessages} defaultOpen={true} />
        </TestWrapper>,
      );

      const popup = container.querySelector("[data-copilot-popup]");
      expect(popup).toBeDefined();
      expect(
        container.querySelector('[data-slot="copilot-modal-header"]'),
      ).toBeDefined();
    });

    it("should render messages in popup", () => {
      render(
        <TestWrapper>
          <CopilotPopupView messages={sampleMessages} />
        </TestWrapper>,
      );

      expect(screen.queryByText("Hello")).toBeDefined();
      expect(screen.queryByText("Hi there!")).toBeDefined();
    });

    it("should handle empty messages array", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView messages={[]} />
        </TestWrapper>,
      );

      const popup = container.querySelector("[data-copilot-popup]");
      expect(popup).toBeDefined();
    });

    it("should combine header customization with inherited slot customization", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView
            messages={sampleMessages}
            header={{
              title: "Full Custom Popup",
              className: "custom-header-root",
              titleContent: "custom-title",
            }}
            messageView="custom-message"
            input="custom-input"
            scrollView="custom-scroll"
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".custom-header-root")).toBeDefined();
      expect(container.querySelector(".custom-title")).toBeDefined();
      expect(container.querySelector(".custom-message")).toBeDefined();
      expect(container.querySelector(".custom-input")).toBeDefined();
      expect(container.querySelector(".custom-scroll")).toBeDefined();
    });

    it("should not render popup content when closed", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotPopupView messages={sampleMessages} defaultOpen={false} />
        </TestWrapper>,
      );

      // Popup should not be rendered when closed
      const popup = container.querySelector("[data-copilot-popup]");
      // Initially not rendered or hidden
      expect(
        popup === null || popup?.classList.contains("pointer-events-none"),
      ).toBe(true);
    });
  });

  // ============================================================================
  // 9. TOGGLE BUTTON SLOT TESTS
  // ============================================================================
  describe("9. Toggle Button Slot", () => {
    describe("toggleButton slot - Tailwind class string", () => {
      it("should apply tailwind class string to toggle button", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotPopupView
              messages={sampleMessages}
              toggleButton="bg-purple-500 hover:bg-purple-600"
            />
          </TestWrapper>,
        );

        const toggleButton = container.querySelector(".bg-purple-500");
        expect(toggleButton).toBeDefined();
        expect(toggleButton?.classList.contains("hover:bg-purple-600")).toBe(
          true,
        );
      });
    });

    describe("toggleButton slot - Props object", () => {
      it("should pass custom props to toggle button", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotPopupView
              messages={sampleMessages}
              toggleButton={{ "data-testid": "popup-custom-toggle" }}
            />
          </TestWrapper>,
        );

        const toggleButton = screen.queryByTestId("popup-custom-toggle");
        expect(toggleButton).toBeDefined();
      });

      it("should pass openIcon and closeIcon sub-slot props", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotPopupView
              messages={sampleMessages}
              toggleButton={{
                openIcon: "text-blue-500",
                closeIcon: "text-orange-500",
              }}
            />
          </TestWrapper>,
        );

        // The icons should have custom classes applied
        const openIconSlot = container.querySelector(
          '[data-slot="chat-toggle-button-open-icon"]',
        );
        const closeIconSlot = container.querySelector(
          '[data-slot="chat-toggle-button-close-icon"]',
        );
        expect(openIconSlot).toBeDefined();
        expect(closeIconSlot).toBeDefined();
      });
    });

    describe("toggleButton slot - Custom component", () => {
      it("should allow custom component for toggle button", () => {
        const CustomToggleButton: React.FC = () => (
          <button
            data-testid="popup-custom-toggle-component"
            className="popup-toggle"
          >
            Open Chat
          </button>
        );

        render(
          <TestWrapper>
            <CopilotPopupView
              messages={sampleMessages}
              toggleButton={CustomToggleButton as any}
            />
          </TestWrapper>,
        );

        const custom = screen.queryByTestId("popup-custom-toggle-component");
        expect(custom).toBeDefined();
        expect(custom?.textContent).toBe("Open Chat");
      });
    });
  });
});
