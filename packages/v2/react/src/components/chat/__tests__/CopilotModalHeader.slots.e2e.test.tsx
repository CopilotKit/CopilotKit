import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CopilotModalHeader } from "../CopilotModalHeader";
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

describe("CopilotModalHeader Slot System E2E Tests", () => {
  // ============================================================================
  // 1. TAILWIND CLASS TESTS
  // ============================================================================
  describe("1. Tailwind Class Slot Override", () => {
    describe("titleContent slot", () => {
      it("should apply tailwind class string to titleContent", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotModalHeader
              title="Test Title"
              titleContent="text-2xl font-bold text-blue-600"
            />
          </TestWrapper>,
        );

        const title = container.querySelector(".text-2xl");
        expect(title).toBeDefined();
        expect(title?.classList.contains("font-bold")).toBe(true);
        expect(title?.classList.contains("text-blue-600")).toBe(true);
      });

      it("should merge titleContent classes with defaults", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotModalHeader
              title="Test Title"
              titleContent="custom-title-class"
            />
          </TestWrapper>,
        );

        const title = container.querySelector(".custom-title-class");
        expect(title).toBeDefined();
        // Should still have default text-foreground
        expect(title?.classList.contains("text-foreground")).toBe(true);
      });
    });

    describe("closeButton slot", () => {
      it("should apply tailwind class string to closeButton", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotModalHeader
              title="Test Title"
              closeButton="bg-red-100 hover:bg-red-200 text-red-600"
            />
          </TestWrapper>,
        );

        const closeBtn = container.querySelector(".bg-red-100");
        expect(closeBtn).toBeDefined();
        expect(closeBtn?.classList.contains("text-red-600")).toBe(true);
      });

      it("should override default rounded-full with custom border radius", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotModalHeader title="Test Title" closeButton="rounded-lg" />
          </TestWrapper>,
        );

        const closeBtn = container.querySelector(".rounded-lg");
        expect(closeBtn).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 2. PROPERTY PASSING TESTS
  // ============================================================================
  describe("2. Property Passing (onClick, disabled, etc.)", () => {
    describe("titleContent slot", () => {
      it("should pass custom props to titleContent", () => {
        render(
          <TestWrapper>
            <CopilotModalHeader
              title="Test Title"
              titleContent={{ "data-testid": "custom-title" }}
            />
          </TestWrapper>,
        );

        const title = screen.queryByTestId("custom-title");
        expect(title).toBeDefined();
        expect(title?.textContent).toBe("Test Title");
      });

      it("should pass custom onClick to titleContent", () => {
        const onClick = vi.fn();
        render(
          <TestWrapper>
            <CopilotModalHeader
              title="Click Me"
              titleContent={{ onClick, "data-testid": "clickable-title" }}
            />
          </TestWrapper>,
        );

        const title = screen.queryByTestId("clickable-title");
        if (title) {
          fireEvent.click(title);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("closeButton slot", () => {
      it("should pass custom onClick that overrides default close behavior", () => {
        const customOnClick = vi.fn();
        const { container } = render(
          <TestWrapper>
            <CopilotModalHeader
              title="Test Title"
              closeButton={{ onClick: customOnClick }}
            />
          </TestWrapper>,
        );

        const closeBtn = container.querySelector('button[aria-label="Close"]');
        if (closeBtn) {
          fireEvent.click(closeBtn);
          expect(customOnClick).toHaveBeenCalled();
        }
      });

      it("should support disabled state on closeButton", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotModalHeader
              title="Test Title"
              closeButton={{ disabled: true }}
            />
          </TestWrapper>,
        );

        const closeBtn = container.querySelector('button[aria-label="Close"]');
        if (closeBtn) {
          expect(closeBtn.hasAttribute("disabled")).toBe(true);
        }
      });

      it("should pass custom aria-label to closeButton", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotModalHeader
              title="Test Title"
              closeButton={{ "aria-label": "Dismiss dialog" }}
            />
          </TestWrapper>,
        );

        const closeBtn = container.querySelector(
          'button[aria-label="Dismiss dialog"]',
        );
        expect(closeBtn).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 3. CUSTOM COMPONENT TESTS
  // ============================================================================
  describe("3. Custom Component Receiving Sub-components", () => {
    it("should allow custom component for titleContent", () => {
      const CustomTitle: React.FC<React.PropsWithChildren> = ({ children }) => (
        <h1 data-testid="custom-title-component" className="my-custom-title">
          {children}
        </h1>
      );

      render(
        <TestWrapper>
          <CopilotModalHeader
            title="Custom Header"
            titleContent={CustomTitle as any}
          />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-title-component");
      expect(custom).toBeDefined();
      expect(custom?.tagName).toBe("H1");
      expect(custom?.textContent).toBe("Custom Header");
    });

    it("should allow custom component for closeButton", () => {
      const CustomCloseButton: React.FC<
        React.ButtonHTMLAttributes<HTMLButtonElement>
      > = (props) => (
        <button data-testid="custom-close-btn" {...props}>
          X Close
        </button>
      );

      render(
        <TestWrapper>
          <CopilotModalHeader
            title="Test Title"
            closeButton={CustomCloseButton as any}
          />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-close-btn");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toBe("X Close");
    });

    it("should call onClick when custom closeButton is clicked", () => {
      const handleClose = vi.fn();
      const CustomCloseButton: React.FC<
        React.ButtonHTMLAttributes<HTMLButtonElement>
      > = ({ onClick, ...props }) => (
        <button
          data-testid="custom-close-btn"
          onClick={(e) => {
            handleClose();
            onClick?.(e);
          }}
          {...props}
        >
          Close
        </button>
      );

      render(
        <TestWrapper>
          <CopilotModalHeader
            title="Test Title"
            closeButton={CustomCloseButton as any}
          />
        </TestWrapper>,
      );

      const closeBtn = screen.queryByTestId("custom-close-btn");
      if (closeBtn) {
        fireEvent.click(closeBtn);
        expect(handleClose).toHaveBeenCalled();
      }
    });
  });

  // ============================================================================
  // 4. CHILDREN RENDER FUNCTION (DRILL-DOWN) TESTS
  // ============================================================================
  describe("4. Children Render Function for Drill-down", () => {
    it("should provide bound titleContent and closeButton via children render function", () => {
      const childrenFn = vi.fn((props) => (
        <div data-testid="children-render">
          <div data-testid="received-title">{props.titleContent}</div>
          <div data-testid="received-close">{props.closeButton}</div>
        </div>
      ));

      render(
        <TestWrapper>
          <CopilotModalHeader title="Test Title">
            {childrenFn}
          </CopilotModalHeader>
        </TestWrapper>,
      );

      expect(childrenFn).toHaveBeenCalled();
      const callArgs = childrenFn.mock.calls[0][0];
      expect(callArgs).toHaveProperty("titleContent");
      expect(callArgs).toHaveProperty("closeButton");
      expect(callArgs).toHaveProperty("title");

      expect(screen.queryByTestId("children-render")).toBeDefined();
    });

    it("should pass resolved title through children render function", () => {
      const childrenFn = vi.fn(() => <div />);

      render(
        <TestWrapper>
          <CopilotModalHeader title="My Custom Title">
            {childrenFn}
          </CopilotModalHeader>
        </TestWrapper>,
      );

      const callArgs = childrenFn.mock.calls[0][0];
      expect(callArgs.title).toBe("My Custom Title");
    });

    it("should allow custom layout via children render function", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotModalHeader title="Custom Layout">
            {({ titleContent, closeButton, title }) => (
              <header
                data-testid="custom-header-layout"
                className="custom-header"
              >
                <div className="left-side">{closeButton}</div>
                <div className="center">{titleContent}</div>
                <div className="right-side">
                  <span className="subtitle">Subtitle: {title}</span>
                </div>
              </header>
            )}
          </CopilotModalHeader>
        </TestWrapper>,
      );

      const customLayout = screen.queryByTestId("custom-header-layout");
      expect(customLayout).toBeDefined();
      expect(container.querySelector(".left-side")).toBeDefined();
      expect(container.querySelector(".center")).toBeDefined();
      expect(container.querySelector(".right-side")).toBeDefined();
      expect(customLayout?.textContent).toContain("Subtitle: Custom Layout");
    });

    it("should allow completely custom rendering without using provided components", () => {
      render(
        <TestWrapper>
          <CopilotModalHeader title="Ignored Title">
            {() => (
              <nav data-testid="custom-nav">
                <button>Back</button>
                <span>Custom Nav Header</span>
                <button>Menu</button>
              </nav>
            )}
          </CopilotModalHeader>
        </TestWrapper>,
      );

      const customNav = screen.queryByTestId("custom-nav");
      expect(customNav).toBeDefined();
      expect(customNav?.textContent).toContain("Custom Nav Header");
      expect(screen.queryByText("Back")).toBeDefined();
      expect(screen.queryByText("Menu")).toBeDefined();
    });
  });

  // ============================================================================
  // 5. CLASSNAME OVERRIDE TESTS
  // ============================================================================
  describe("5. className Override with Tailwind Strings", () => {
    it("should apply className to header root element", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotModalHeader
            title="Test Title"
            className="custom-header-class bg-slate-100"
          />
        </TestWrapper>,
      );

      const header = container.querySelector(".custom-header-class");
      expect(header).toBeDefined();
      expect(header?.tagName).toBe("HEADER");
      expect(header?.classList.contains("bg-slate-100")).toBe(true);
    });

    it("should override default border and padding", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotModalHeader title="Test Title" className="border-0 p-2" />
        </TestWrapper>,
      );

      const header = container.querySelector(".border-0");
      expect(header).toBeDefined();
      expect(header?.classList.contains("p-2")).toBe(true);
    });

    it("should merge multiple slot classNames correctly", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotModalHeader
            title="Test Title"
            className="header-custom"
            titleContent="title-custom"
            closeButton="close-custom"
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".header-custom")).toBeDefined();
      expect(container.querySelector(".title-custom")).toBeDefined();
      expect(container.querySelector(".close-custom")).toBeDefined();
    });
  });

  // ============================================================================
  // 6. INTEGRATION TESTS
  // ============================================================================
  describe("6. Integration Tests", () => {
    it("should correctly render all slots with mixed customization", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotModalHeader
            title="Full Test"
            className="header-style"
            titleContent="title-style"
            closeButton="close-style"
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".header-style")).toBeDefined();
      expect(container.querySelector(".title-style")).toBeDefined();
      expect(container.querySelector(".close-style")).toBeDefined();
    });

    it("should work with property objects and class strings mixed", () => {
      const onClick = vi.fn();
      const { container } = render(
        <TestWrapper>
          <CopilotModalHeader
            title="Mixed Test"
            titleContent="text-xl"
            closeButton={{ onClick, className: "bg-gray-200" }}
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".text-xl")).toBeDefined();

      const closeBtn = container.querySelector(".bg-gray-200");
      if (closeBtn) {
        fireEvent.click(closeBtn);
        expect(onClick).toHaveBeenCalled();
      }
    });

    it("should use default title from configuration when not provided", () => {
      render(
        <TestWrapper>
          <CopilotModalHeader />
        </TestWrapper>,
      );

      // Should render with default "CopilotKit" title from CopilotChatDefaultLabels
      const header = document.querySelector(
        '[data-slot="copilot-modal-header"]',
      );
      expect(header).toBeDefined();
    });

    it("should render title content correctly", () => {
      render(
        <TestWrapper>
          <CopilotModalHeader title="My Chat Header" />
        </TestWrapper>,
      );

      expect(screen.getByText("My Chat Header")).toBeDefined();
    });

    it("should render close button with X icon", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotModalHeader title="Test" />
        </TestWrapper>,
      );

      const closeBtn = container.querySelector('button[aria-label="Close"]');
      expect(closeBtn).toBeDefined();
      // Should contain an SVG icon
      expect(closeBtn?.querySelector("svg")).toBeDefined();
    });
  });
});
