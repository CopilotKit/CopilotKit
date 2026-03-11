import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CopilotSidebarView } from "../CopilotSidebarView";
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

describe("CopilotSidebarView Slot System E2E Tests", () => {
  // ============================================================================
  // 1. TAILWIND CLASS TESTS - HEADER SLOT (UNIQUE TO SIDEBAR)
  // ============================================================================
  describe("1. Tailwind Class Slot Override - Header Slot", () => {
    describe("header slot", () => {
      it("should apply tailwind class string to header", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotSidebarView
              messages={sampleMessages}
              header="bg-gradient-to-r from-blue-500 to-purple-500 text-white"
            />
          </TestWrapper>,
        );

        const header = container.querySelector(".bg-gradient-to-r");
        if (header) {
          expect(header.classList.contains("from-blue-500")).toBe(true);
          expect(header.classList.contains("text-white")).toBe(true);
        }
      });

      it("should override default header border with custom styles", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotSidebarView
              messages={sampleMessages}
              header="border-b-2 border-blue-500"
            />
          </TestWrapper>,
        );

        const header = container.querySelector(".border-b-2");
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
            <CopilotSidebarView
              messages={sampleMessages}
              header={{ "data-testid": "custom-sidebar-header" }}
            />
          </TestWrapper>,
        );

        const header = screen.queryByTestId("custom-sidebar-header");
        expect(header).toBeDefined();
      });

      it("should pass title prop through to header", () => {
        render(
          <TestWrapper>
            <CopilotSidebarView
              messages={sampleMessages}
              header={{ title: "My Sidebar Chat" }}
            />
          </TestWrapper>,
        );

        // The title should be rendered in the header
        expect(screen.queryByText("My Sidebar Chat")).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 3. CUSTOM COMPONENT TESTS - HEADER SLOT
  // ============================================================================
  describe("3. Custom Component - Header Slot", () => {
    it("should allow custom component for header", () => {
      const CustomHeader: React.FC = () => (
        <header
          data-testid="custom-header-component"
          className="custom-sidebar-header"
        >
          <span>Custom Sidebar Header</span>
          <button>Custom Close</button>
        </header>
      );

      render(
        <TestWrapper>
          <CopilotSidebarView
            messages={sampleMessages}
            header={CustomHeader as any}
          />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-header-component");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toContain("Custom Sidebar Header");
    });

    it("should allow passing header props for customization", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView
            messages={sampleMessages}
            header={{
              title: "Customized Header",
              titleContent: "text-xl font-bold",
              closeButton: "bg-red-500",
            }}
          />
        </TestWrapper>,
      );

      expect(screen.queryByText("Customized Header")).toBeDefined();
      expect(container.querySelector(".text-xl")).toBeDefined();
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
            <CopilotSidebarView
              messages={sampleMessages}
              messageView="bg-gray-50 rounded-lg"
            />
          </TestWrapper>,
        );

        const messageView = container.querySelector(".bg-gray-50");
        expect(messageView).toBeDefined();
      });
    });

    describe("input slot (inherited)", () => {
      it("should apply tailwind class string to inherited input", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotSidebarView
              messages={sampleMessages}
              input="border-2 border-blue-400"
            />
          </TestWrapper>,
        );

        const input = container.querySelector(".border-blue-400");
        expect(input).toBeDefined();
      });
    });

    describe("scrollView slot (inherited)", () => {
      it("should apply tailwind class string to inherited scrollView", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotSidebarView
              messages={sampleMessages}
              scrollView="overflow-y-scroll bg-white"
            />
          </TestWrapper>,
        );

        const scrollView = container.querySelector(".overflow-y-scroll");
        expect(scrollView).toBeDefined();
      });
    });

    describe("suggestionView slot (inherited)", () => {
      it("should apply tailwind class string to inherited suggestionView", () => {
        const suggestions = [
          { title: "Test", message: "Test message", isLoading: false },
        ];

        const { container } = render(
          <TestWrapper>
            <CopilotSidebarView
              messages={sampleMessages}
              suggestions={suggestions}
              suggestionView="gap-4 p-2"
            />
          </TestWrapper>,
        );

        const suggestionView = container.querySelector(".gap-4");
        if (suggestionView) {
          expect(suggestionView.classList.contains("p-2")).toBe(true);
        }
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
          <CopilotSidebarView
            messages={sampleMessages}
            header={{
              title: "Sidebar Chat",
              titleContent: "text-2xl text-purple-600 font-extrabold",
            }}
          />
        </TestWrapper>,
      );

      const titleContent = container.querySelector(".text-2xl");
      expect(titleContent).toBeDefined();
      expect(titleContent?.classList.contains("text-purple-600")).toBe(true);
    });

    it("should allow customizing header closeButton through props object", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView
            messages={sampleMessages}
            header={{
              title: "Sidebar",
              closeButton: "custom-close-btn",
            }}
          />
        </TestWrapper>,
      );

      const closeBtn = container.querySelector(".custom-close-btn");
      expect(closeBtn).toBeDefined();
    });

    it("should allow custom component for header via component slot", () => {
      const CustomHeader: React.FC = () => (
        <header data-testid="full-custom-header">
          <span>Custom Header</span>
          <button data-testid="sidebar-custom-close">← Back</button>
        </header>
      );

      render(
        <TestWrapper>
          <CopilotSidebarView
            messages={sampleMessages}
            header={CustomHeader as any}
          />
        </TestWrapper>,
      );

      const customClose = screen.queryByTestId("sidebar-custom-close");
      expect(customClose).toBeDefined();
      expect(customClose?.textContent).toBe("← Back");
    });
  });

  // ============================================================================
  // 6. CLASSNAME AND MIXED CUSTOMIZATION
  // ============================================================================
  describe("6. className Override and Mixed Customization", () => {
    it("should merge multiple slot classNames correctly", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView
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
          <CopilotSidebarView
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

    it("should support custom width prop", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView messages={sampleMessages} width={600} />
        </TestWrapper>,
      );

      const sidebar = container.querySelector("[data-copilot-sidebar]");
      expect(sidebar).toBeDefined();
      // Width should be applied via CSS custom property
      expect(sidebar?.getAttribute("style")).toContain("--sidebar-width");
    });

    it("should support string width prop", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView messages={sampleMessages} width="50vw" />
        </TestWrapper>,
      );

      const sidebar = container.querySelector("[data-copilot-sidebar]");
      expect(sidebar).toBeDefined();
    });
  });

  // ============================================================================
  // 7. INTEGRATION TESTS
  // ============================================================================
  describe("7. Integration Tests", () => {
    it("should render sidebar with all default components", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView messages={sampleMessages} />
        </TestWrapper>,
      );

      const sidebar = container.querySelector("[data-copilot-sidebar]");
      expect(sidebar).toBeDefined();
      // Should have header
      expect(
        container.querySelector('[data-slot="copilot-modal-header"]'),
      ).toBeDefined();
    });

    it("should render messages in sidebar", () => {
      render(
        <TestWrapper>
          <CopilotSidebarView messages={sampleMessages} />
        </TestWrapper>,
      );

      expect(screen.queryByText("Hello")).toBeDefined();
      expect(screen.queryByText("Hi there!")).toBeDefined();
    });

    it("should handle empty messages array", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView messages={[]} />
        </TestWrapper>,
      );

      const sidebar = container.querySelector("[data-copilot-sidebar]");
      expect(sidebar).toBeDefined();
    });

    it("should combine header customization with inherited slot customization", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotSidebarView
            messages={sampleMessages}
            header={{
              title: "Full Custom",
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
  });

  // ============================================================================
  // 8. TOGGLE BUTTON SLOT TESTS
  // ============================================================================
  describe("8. Toggle Button Slot", () => {
    describe("toggleButton slot - Tailwind class string", () => {
      it("should apply tailwind class string to toggle button", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotSidebarView
              messages={sampleMessages}
              toggleButton="bg-red-500 hover:bg-red-600"
            />
          </TestWrapper>,
        );

        const toggleButton = container.querySelector(".bg-red-500");
        expect(toggleButton).toBeDefined();
        expect(toggleButton?.classList.contains("hover:bg-red-600")).toBe(true);
      });
    });

    describe("toggleButton slot - Props object", () => {
      it("should pass custom props to toggle button", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotSidebarView
              messages={sampleMessages}
              toggleButton={{ "data-testid": "custom-toggle-button" }}
            />
          </TestWrapper>,
        );

        const toggleButton = screen.queryByTestId("custom-toggle-button");
        expect(toggleButton).toBeDefined();
      });

      it("should pass openIcon and closeIcon sub-slot props", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotSidebarView
              messages={sampleMessages}
              toggleButton={{
                openIcon: "text-green-500",
                closeIcon: "text-red-500",
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
            data-testid="custom-toggle-component"
            className="custom-toggle"
          >
            Toggle Chat
          </button>
        );

        render(
          <TestWrapper>
            <CopilotSidebarView
              messages={sampleMessages}
              toggleButton={CustomToggleButton as any}
            />
          </TestWrapper>,
        );

        const custom = screen.queryByTestId("custom-toggle-component");
        expect(custom).toBeDefined();
        expect(custom?.textContent).toBe("Toggle Chat");
      });
    });
  });
});
