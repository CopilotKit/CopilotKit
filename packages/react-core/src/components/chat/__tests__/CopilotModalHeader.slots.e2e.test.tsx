import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi } from "vitest";
import { CopilotChatDefaultLabels } from "@copilotkit/core";
import { CopilotModalHeader } from "../CopilotModalHeader";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import {
  CopilotChatConfigurationProvider,
  useCopilotChatConfiguration,
} from "../../../providers/CopilotChatConfigurationProvider";

// Wrapper to provide required context
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      {children}
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

// Shows whether the surrounding modal is open, so a test can see the close
// button's effect.
function ModalState() {
  const config = useCopilotChatConfiguration();
  return <span data-testid="modal-state">{String(config?.isModalOpen)}</span>;
}

const OpenModalWrapper: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread" isModalDefaultOpen>
      {children}
      <ModalState />
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

        expect(container.querySelector(".text-2xl")).toHaveClass(
          "font-bold",
          "text-blue-600",
        );
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

        // Should still have the default title class
        expect(container.querySelector(".custom-title-class")).toHaveClass(
          "cpk-modal-header-title",
        );
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

        expect(container.querySelector(".bg-red-100")).toHaveClass(
          "cpk-modal-header-close-button",
          "text-red-600",
        );
      });
    });
  });

  // ============================================================================
  // 2. PROPERTY PASSING TESTS
  // ============================================================================
  describe("2. Property Passing (onClick, disabled, etc.)", () => {
    describe("titleContent slot", () => {
      it("should pass custom props to titleContent", () => {
        const titleContentProps: Partial<
          React.ComponentProps<typeof CopilotModalHeader.Title>
        > & { "data-testid": string } = { "data-testid": "custom-title" };
        render(
          <TestWrapper>
            <CopilotModalHeader
              title="Test Title"
              titleContent={titleContentProps}
            />
          </TestWrapper>,
        );

        expect(screen.getByTestId("custom-title")).toHaveTextContent(
          "Test Title",
        );
      });

      it("should pass custom onClick to titleContent", () => {
        const onClick = vi.fn();
        const titleContentProps = {
          onClick,
          "data-testid": "clickable-title",
        };
        render(
          <TestWrapper>
            <CopilotModalHeader
              title="Click Me"
              titleContent={titleContentProps}
            />
          </TestWrapper>,
        );

        fireEvent.click(screen.getByTestId("clickable-title"));
        expect(onClick).toHaveBeenCalledTimes(1);
      });
    });

    describe("closeButton slot", () => {
      it("should pass custom onClick that overrides default close behavior", () => {
        const customOnClick = vi.fn();
        render(
          <OpenModalWrapper>
            <CopilotModalHeader
              title="Test Title"
              closeButton={{ onClick: customOnClick }}
            />
          </OpenModalWrapper>,
        );

        fireEvent.click(screen.getByTestId("copilot-close-button"));

        expect(customOnClick).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId("modal-state")).toHaveTextContent("true");
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

        expect(screen.getByTestId("copilot-close-button")).toBeDisabled();
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

        expect(screen.getByTestId("copilot-close-button")).toHaveAccessibleName(
          "Dismiss dialog",
        );
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
            titleContent={CustomTitle}
          />
        </TestWrapper>,
      );

      const custom = screen.getByTestId("custom-title-component");
      expect(custom.tagName).toBe("H1");
      expect(custom).toHaveTextContent("Custom Header");
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
            closeButton={CustomCloseButton}
          />
        </TestWrapper>,
      );

      expect(screen.getByTestId("custom-close-btn")).toHaveTextContent(
        "X Close",
      );
    });

    it("closes the modal through the onClick a custom closeButton receives", () => {
      const CustomCloseButton: React.FC<
        React.ButtonHTMLAttributes<HTMLButtonElement>
      > = ({ onClick }) => (
        <button data-testid="custom-close-btn" onClick={onClick}>
          Close
        </button>
      );

      render(
        <OpenModalWrapper>
          <CopilotModalHeader
            title="Test Title"
            closeButton={CustomCloseButton}
          />
        </OpenModalWrapper>,
      );
      expect(screen.getByTestId("modal-state")).toHaveTextContent("true");

      fireEvent.click(screen.getByTestId("custom-close-btn"));

      expect(screen.getByTestId("modal-state")).toHaveTextContent("false");
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
      const callArgs = childrenFn.mock.calls[0]![0];
      expect(callArgs).toHaveProperty("titleContent");
      expect(callArgs).toHaveProperty("closeButton");
      expect(callArgs).toHaveProperty("title");
    });

    it("should pass resolved title through children render function", () => {
      const childrenFn = vi.fn((_props: { title?: string }) => <div />);

      render(
        <TestWrapper>
          <CopilotModalHeader title="My Custom Title">
            {childrenFn}
          </CopilotModalHeader>
        </TestWrapper>,
      );

      const callArgs = childrenFn.mock.calls[0]![0];
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

      const customLayout = screen.getByTestId("custom-header-layout");
      expect(
        container.querySelector(
          ".left-side [data-testid=copilot-close-button]",
        ),
      ).not.toBeNull();
      expect(
        container.querySelector(".center [data-testid=copilot-header-title]"),
      ).toHaveTextContent("Custom Layout");
      expect(customLayout).toHaveTextContent("Subtitle: Custom Layout");
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

      expect(screen.getByTestId("custom-nav")).toHaveTextContent(
        "BackCustom Nav HeaderMenu",
      );
      expect(screen.queryByTestId("copilot-modal-header")).toBeNull();
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
      expect(header?.tagName).toBe("HEADER");
      expect(header).toHaveClass("cpk-modal-header", "bg-slate-100");
    });
  });

  // ============================================================================
  // 6. INTEGRATION TESTS
  // ============================================================================
  describe("6. Integration Tests", () => {
    it("should use default title from configuration when not provided", () => {
      render(
        <TestWrapper>
          <CopilotModalHeader />
        </TestWrapper>,
      );

      expect(screen.getByTestId("copilot-header-title")).toHaveTextContent(
        CopilotChatDefaultLabels.modalHeaderTitle,
      );
    });

    it("should render title content correctly", () => {
      render(
        <TestWrapper>
          <CopilotModalHeader title="My Chat Header" />
        </TestWrapper>,
      );

      expect(screen.getByText("My Chat Header")).toBeInTheDocument();
    });

    it("should render close button with X icon", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotModalHeader title="Test" />
        </TestWrapper>,
      );

      const closeBtn = container.querySelector('button[aria-label="Close"]');
      // Should contain an SVG icon
      expect(closeBtn?.querySelector("svg")).toBeInTheDocument();
    });
  });
});
