import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { CopilotPopup } from "../CopilotPopup";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { MockStepwiseAgent } from "@/__tests__/utils/test-helpers";
import { DEFAULT_AGENT_ID } from "@copilotkitnext/shared";

const getToggleButton = (container: HTMLElement) =>
  container.querySelector("[data-slot='chat-toggle-button']") as HTMLButtonElement | null;

describe("CopilotPopup", () => {
  describe("toggleButton slot", () => {
    it("renders default toggle button when slot is undefined", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup />
        </CopilotKitProvider>
      );

      const toggleButton = getToggleButton(container);
      expect(toggleButton).not.toBeNull();
      expect(toggleButton?.tagName).toBe("BUTTON");
    });

    it("hides toggle button when toggleButton={null}", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup toggleButton={null} />
        </CopilotKitProvider>
      );

      const toggleButton = getToggleButton(container);
      expect(toggleButton).toBeNull();
    });

    it("applies custom className when toggleButton is a string", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup toggleButton="custom-toggle-class" />
        </CopilotKitProvider>
      );

      const toggleButton = getToggleButton(container);
      expect(toggleButton).not.toBeNull();
      expect(toggleButton?.classList.contains("custom-toggle-class")).toBe(true);
    });

    it("renders custom component when toggleButton is a component", () => {
      const CustomToggleButton = (
        props: React.ButtonHTMLAttributes<HTMLButtonElement>
      ) => (
        <button {...props} data-testid="custom-toggle">
          Custom Toggle
        </button>
      );

      render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup toggleButton={CustomToggleButton} />
        </CopilotKitProvider>
      );

      const customButton = screen.getByTestId("custom-toggle");
      expect(customButton).toBeDefined();
      expect(customButton.textContent).toContain("Custom Toggle");
    });

    it("merges props when toggleButton is an object", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup
            toggleButton={{
              className: "custom-class",
              "data-custom": "true",
            }}
          />
        </CopilotKitProvider>
      );

      const toggleButton = getToggleButton(container);
      expect(toggleButton).not.toBeNull();
      expect(toggleButton?.classList.contains("custom-class")).toBe(true);
      expect(toggleButton?.getAttribute("data-custom")).toBe("true");
    });
  });

  describe("Toggle button functionality", () => {
    it("toggles popup open/closed when button is clicked", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup defaultOpen={false} />
        </CopilotKitProvider>
      );

      const toggleButton = getToggleButton(container);
      expect(toggleButton).not.toBeNull();

      // Initially closed
      expect(toggleButton?.getAttribute("data-state")).toBe("closed");

      // Click to open
      fireEvent.click(toggleButton!);
      expect(toggleButton?.getAttribute("data-state")).toBe("open");

      // Click to close
      fireEvent.click(toggleButton!);
      expect(toggleButton?.getAttribute("data-state")).toBe("closed");
    });

    it("respects defaultOpen={true}", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup defaultOpen={true} />
        </CopilotKitProvider>
      );

      const toggleButton = getToggleButton(container);
      expect(toggleButton?.getAttribute("data-state")).toBe("open");
    });

    it("respects defaultOpen={false}", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup defaultOpen={false} />
        </CopilotKitProvider>
      );

      const toggleButton = getToggleButton(container);
      expect(toggleButton?.getAttribute("data-state")).toBe("closed");
    });

    it("custom toggle button receives click events", () => {
      const mockOnClick = vi.fn();
      const CustomToggleButton = (
        props: React.ButtonHTMLAttributes<HTMLButtonElement>
      ) => {
        const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
          mockOnClick(e);
          // Custom component would need to use useCopilotChatConfiguration
          // to control modal state, just like the default component does
        };
        return (
          <button {...props} onClick={handleClick} data-testid="custom-toggle">
            Custom Toggle
          </button>
        );
      };

      render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup
            toggleButton={CustomToggleButton}
            defaultOpen={false}
          />
        </CopilotKitProvider>
      );

      const customButton = screen.getByTestId("custom-toggle");
      fireEvent.click(customButton);

      expect(mockOnClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("Accessibility", () => {
    it("maintains ARIA attributes on default button", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup defaultOpen={false} />
        </CopilotKitProvider>
      );

      const toggleButton = getToggleButton(container);
      expect(toggleButton?.getAttribute("aria-label")).toBeTruthy();
      expect(toggleButton?.getAttribute("aria-pressed")).toBe("false");
    });

    it("updates aria-pressed when state changes", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup defaultOpen={false} />
        </CopilotKitProvider>
      );

      const toggleButton = getToggleButton(container);
      expect(toggleButton?.getAttribute("aria-pressed")).toBe("false");

      fireEvent.click(toggleButton!);
      expect(toggleButton?.getAttribute("aria-pressed")).toBe("true");
    });
  });

  describe("Integration with other slots", () => {
    it("works with header slot", () => {
      const CustomHeader = () => <div data-testid="custom-header">Custom Header</div>;

      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup
            header={CustomHeader}
            toggleButton="custom-toggle-class"
          />
        </CopilotKitProvider>
      );

      // Both customizations should work
      const toggleButton = getToggleButton(container);
      expect(toggleButton?.classList.contains("custom-toggle-class")).toBe(true);
    });

    it("works when toggleButton is hidden and other slots are customized", () => {
      const CustomHeader = () => <div data-testid="custom-header">Custom Header</div>;

      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup header={CustomHeader} toggleButton={null} />
        </CopilotKitProvider>
      );

      const toggleButton = getToggleButton(container);
      expect(toggleButton).toBeNull();
    });

    it("works with popup-specific props (width, height, clickOutsideToClose)", () => {
      const { container } = render(
        <CopilotKitProvider
          agents__unsafe_dev_only={{
            [DEFAULT_AGENT_ID]: new MockStepwiseAgent(),
          }}
        >
          <CopilotPopup
            width={500}
            height={600}
            clickOutsideToClose={false}
            toggleButton="custom-toggle-class"
          />
        </CopilotKitProvider>
      );

      const toggleButton = getToggleButton(container);
      expect(toggleButton?.classList.contains("custom-toggle-class")).toBe(true);
    });
  });
});
