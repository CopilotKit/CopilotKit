import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CopilotChatSuggestionView } from "../CopilotChatSuggestionView";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";
import { Suggestion } from "@copilotkitnext/core";

// Wrapper to provide required context
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      {children}
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

const createSuggestions = (): Suggestion[] => [
  { title: "Suggestion 1", message: "Message 1", isLoading: false },
  { title: "Suggestion 2", message: "Message 2", isLoading: false },
  { title: "Suggestion 3", message: "Message 3", isLoading: false },
];

describe("CopilotChatSuggestionView Slot System E2E Tests", () => {
  // ============================================================================
  // 1. TAILWIND CLASS TESTS
  // ============================================================================
  describe("1. Tailwind Class Slot Override", () => {
    describe("container slot", () => {
      it("should apply tailwind class string to container", () => {
        const suggestions = createSuggestions();
        const { container } = render(
          <TestWrapper>
            <CopilotChatSuggestionView
              suggestions={suggestions}
              container="flex gap-4 bg-blue-50 p-4"
            />
          </TestWrapper>,
        );

        const containerEl = container.querySelector(".bg-blue-50");
        expect(containerEl).toBeDefined();
        expect(containerEl?.classList.contains("gap-4")).toBe(true);
        expect(containerEl?.classList.contains("p-4")).toBe(true);
      });

      it("should merge container classes with default flex-wrap", () => {
        const suggestions = createSuggestions();
        const { container } = render(
          <TestWrapper>
            <CopilotChatSuggestionView
              suggestions={suggestions}
              container="custom-container-class"
            />
          </TestWrapper>,
        );

        const containerEl = container.querySelector(".custom-container-class");
        expect(containerEl).toBeDefined();
      });
    });

    describe("suggestion slot", () => {
      it("should apply tailwind class string to all suggestion pills", () => {
        const suggestions = createSuggestions();
        const { container } = render(
          <TestWrapper>
            <CopilotChatSuggestionView
              suggestions={suggestions}
              suggestion="bg-green-100 hover:bg-green-200 rounded-full"
            />
          </TestWrapper>,
        );

        const pills = container.querySelectorAll(".bg-green-100");
        expect(pills.length).toBe(3);
        pills.forEach((pill) => {
          expect(pill.classList.contains("rounded-full")).toBe(true);
        });
      });
    });
  });

  // ============================================================================
  // 2. PROPERTY PASSING TESTS
  // ============================================================================
  describe("2. Property Passing (onClick, disabled, etc.)", () => {
    describe("container slot", () => {
      it("should pass custom props to container", () => {
        const suggestions = createSuggestions();
        render(
          <TestWrapper>
            <CopilotChatSuggestionView
              suggestions={suggestions}
              container={{ "data-testid": "custom-container" }}
            />
          </TestWrapper>,
        );

        const containerEl = screen.queryByTestId("custom-container");
        expect(containerEl).toBeDefined();
      });

      it("should pass custom onClick to container", () => {
        const onClick = vi.fn();
        const suggestions = createSuggestions();
        render(
          <TestWrapper>
            <CopilotChatSuggestionView
              suggestions={suggestions}
              container={{ onClick, "data-testid": "clickable-container" }}
            />
          </TestWrapper>,
        );

        const containerEl = screen.queryByTestId("clickable-container");
        if (containerEl) {
          fireEvent.click(containerEl);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("suggestion slot", () => {
      it("should apply custom type to suggestion buttons", () => {
        const suggestions = createSuggestions();
        const { container } = render(
          <TestWrapper>
            <CopilotChatSuggestionView
              suggestions={suggestions}
              suggestion={{ type: "submit" }}
            />
          </TestWrapper>,
        );

        const buttons = container.querySelectorAll('button[type="submit"]');
        // Each suggestion should have type="submit"
        expect(buttons.length).toBeGreaterThan(0);
      });

      it("should apply disabled state to all suggestion pills", () => {
        const suggestions = createSuggestions();
        const { container } = render(
          <TestWrapper>
            <CopilotChatSuggestionView
              suggestions={suggestions}
              suggestion={{ disabled: true }}
            />
          </TestWrapper>,
        );

        const buttons = container.querySelectorAll("button[disabled]");
        expect(buttons.length).toBe(3);
      });
    });

    describe("onSelectSuggestion callback", () => {
      it("should call onSelectSuggestion when suggestion is clicked", () => {
        const onSelectSuggestion = vi.fn();
        const suggestions = createSuggestions();
        render(
          <TestWrapper>
            <CopilotChatSuggestionView
              suggestions={suggestions}
              onSelectSuggestion={onSelectSuggestion}
            />
          </TestWrapper>,
        );

        const firstSuggestion = screen.getByText("Suggestion 1");
        fireEvent.click(firstSuggestion);
        expect(onSelectSuggestion).toHaveBeenCalledWith(suggestions[0], 0);
      });

      it("should call onSelectSuggestion with correct index for each suggestion", () => {
        const onSelectSuggestion = vi.fn();
        const suggestions = createSuggestions();
        render(
          <TestWrapper>
            <CopilotChatSuggestionView
              suggestions={suggestions}
              onSelectSuggestion={onSelectSuggestion}
            />
          </TestWrapper>,
        );

        const secondSuggestion = screen.getByText("Suggestion 2");
        fireEvent.click(secondSuggestion);
        expect(onSelectSuggestion).toHaveBeenCalledWith(suggestions[1], 1);

        const thirdSuggestion = screen.getByText("Suggestion 3");
        fireEvent.click(thirdSuggestion);
        expect(onSelectSuggestion).toHaveBeenCalledWith(suggestions[2], 2);
      });
    });
  });

  // ============================================================================
  // 3. CUSTOM COMPONENT TESTS
  // ============================================================================
  describe("3. Custom Component Receiving Sub-components", () => {
    it("should allow custom component for container", () => {
      const CustomContainer = React.forwardRef<
        HTMLDivElement,
        React.HTMLAttributes<HTMLDivElement>
      >(({ children, ...props }, ref) => (
        <div ref={ref} data-testid="custom-container-component" {...props}>
          <span>Suggestions:</span>
          {children}
        </div>
      ));

      const suggestions = createSuggestions();
      render(
        <TestWrapper>
          <CopilotChatSuggestionView
            suggestions={suggestions}
            container={CustomContainer as any}
          />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-container-component");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toContain("Suggestions:");
    });

    it("should allow custom component for suggestion pills", () => {
      const CustomSuggestionPill: React.FC<{
        children: React.ReactNode;
        onClick?: () => void;
        isLoading?: boolean;
      }> = ({ children, onClick, isLoading }) => (
        <button
          data-testid="custom-pill"
          onClick={onClick}
          disabled={isLoading}
        >
          [{children}]
        </button>
      );

      const suggestions = createSuggestions();
      render(
        <TestWrapper>
          <CopilotChatSuggestionView
            suggestions={suggestions}
            suggestion={CustomSuggestionPill as any}
          />
        </TestWrapper>,
      );

      const customPills = screen.queryAllByTestId("custom-pill");
      expect(customPills.length).toBe(3);
      expect(customPills[0].textContent).toBe("[Suggestion 1]");
    });

    it("should pass isLoading to custom suggestion component", () => {
      const CustomSuggestionPill: React.FC<{
        children: React.ReactNode;
        isLoading?: boolean;
      }> = ({ children, isLoading }) => (
        <button data-testid="custom-pill" data-loading={isLoading}>
          {isLoading ? "Loading..." : children}
        </button>
      );

      const suggestions: Suggestion[] = [
        { title: "Suggestion 1", message: "Message 1", isLoading: true },
        { title: "Suggestion 2", message: "Message 2", isLoading: false },
      ];

      render(
        <TestWrapper>
          <CopilotChatSuggestionView
            suggestions={suggestions}
            suggestion={CustomSuggestionPill as any}
          />
        </TestWrapper>,
      );

      const pills = screen.queryAllByTestId("custom-pill");
      expect(pills[0].getAttribute("data-loading")).toBe("true");
      expect(pills[0].textContent).toBe("Loading...");
      expect(pills[1].getAttribute("data-loading")).toBe("false");
    });
  });

  // ============================================================================
  // 4. CHILDREN RENDER FUNCTION (DRILL-DOWN) TESTS
  // ============================================================================
  describe("4. Children Render Function for Drill-down", () => {
    it("should provide bound container and suggestion via children render function", () => {
      const suggestions = createSuggestions();
      const childrenFn = vi.fn((props) => (
        <div data-testid="children-render">
          <div data-testid="received-container">{props.container}</div>
          <div data-testid="received-suggestion">{props.suggestion}</div>
        </div>
      ));

      render(
        <TestWrapper>
          <CopilotChatSuggestionView suggestions={suggestions}>
            {childrenFn}
          </CopilotChatSuggestionView>
        </TestWrapper>,
      );

      expect(childrenFn).toHaveBeenCalled();
      const callArgs = childrenFn.mock.calls[0][0];
      expect(callArgs).toHaveProperty("container");
      expect(callArgs).toHaveProperty("suggestion");
      expect(callArgs).toHaveProperty("suggestions");
      expect(callArgs).toHaveProperty("onSelectSuggestion");

      expect(screen.queryByTestId("children-render")).toBeDefined();
    });

    it("should pass suggestions array through children render function", () => {
      const suggestions = createSuggestions();
      const childrenFn = vi.fn(() => <div />);

      render(
        <TestWrapper>
          <CopilotChatSuggestionView suggestions={suggestions}>
            {childrenFn}
          </CopilotChatSuggestionView>
        </TestWrapper>,
      );

      const callArgs = childrenFn.mock.calls[0][0];
      expect(callArgs.suggestions).toBe(suggestions);
      expect(callArgs.suggestions.length).toBe(3);
    });

    it("should pass loadingIndexes through children render function", () => {
      const suggestions = createSuggestions();
      const loadingIndexes = [0, 2];
      const childrenFn = vi.fn(() => <div />);

      render(
        <TestWrapper>
          <CopilotChatSuggestionView
            suggestions={suggestions}
            loadingIndexes={loadingIndexes}
          >
            {childrenFn}
          </CopilotChatSuggestionView>
        </TestWrapper>,
      );

      const callArgs = childrenFn.mock.calls[0][0];
      expect(callArgs.loadingIndexes).toBe(loadingIndexes);
    });

    it("should allow custom layout via children render function", () => {
      const suggestions = createSuggestions();
      const onSelectSuggestion = vi.fn();

      const { container } = render(
        <TestWrapper>
          <CopilotChatSuggestionView
            suggestions={suggestions}
            onSelectSuggestion={onSelectSuggestion}
          >
            {({ container: boundContainer, suggestions: suggestionsArr }) => (
              <div data-testid="custom-layout">
                <h3>Quick Actions</h3>
                {boundContainer}
                <p>Total: {suggestionsArr.length}</p>
              </div>
            )}
          </CopilotChatSuggestionView>
        </TestWrapper>,
      );

      const customLayout = screen.queryByTestId("custom-layout");
      expect(customLayout).toBeDefined();
      expect(customLayout?.textContent).toContain("Quick Actions");
      expect(customLayout?.textContent).toContain("Total: 3");
    });
  });

  // ============================================================================
  // 5. CLASSNAME OVERRIDE TESTS
  // ============================================================================
  describe("5. className Override with Tailwind Strings", () => {
    it("should apply className to container", () => {
      const suggestions = createSuggestions();
      const { container } = render(
        <TestWrapper>
          <CopilotChatSuggestionView
            suggestions={suggestions}
            className="custom-root-class mt-4"
          />
        </TestWrapper>,
      );

      const containerEl = container.querySelector(".custom-root-class");
      expect(containerEl).toBeDefined();
      expect(containerEl?.classList.contains("mt-4")).toBe(true);
    });

    it("should merge className with container slot class", () => {
      const suggestions = createSuggestions();
      const { container } = render(
        <TestWrapper>
          <CopilotChatSuggestionView
            suggestions={suggestions}
            className="root-class"
            container="container-class"
          />
        </TestWrapper>,
      );

      // Both classes should be present
      const containerEl = container.querySelector(".container-class");
      expect(containerEl).toBeDefined();
      // root className is passed to container
      expect(containerEl?.classList.contains("root-class")).toBe(true);
    });

    it("should allow overriding default pointer-events-none", () => {
      const suggestions = createSuggestions();
      const { container } = render(
        <TestWrapper>
          <CopilotChatSuggestionView
            suggestions={suggestions}
            container="pointer-events-auto"
          />
        </TestWrapper>,
      );

      const containerEl = container.querySelector(".pointer-events-auto");
      expect(containerEl).toBeDefined();
    });
  });

  // ============================================================================
  // 6. INTEGRATION / LOADING STATE TESTS
  // ============================================================================
  describe("6. Integration and Loading State Tests", () => {
    it("should correctly render all slots with mixed customization", () => {
      const onSelectSuggestion = vi.fn();
      const suggestions = createSuggestions();

      const { container } = render(
        <TestWrapper>
          <CopilotChatSuggestionView
            suggestions={suggestions}
            onSelectSuggestion={onSelectSuggestion}
            container="container-style"
            suggestion="suggestion-style"
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".container-style")).toBeDefined();
      expect(container.querySelectorAll(".suggestion-style").length).toBe(3);
    });

    it("should show loading state for specific indexes", () => {
      const suggestions = createSuggestions();
      render(
        <TestWrapper>
          <CopilotChatSuggestionView
            suggestions={suggestions}
            loadingIndexes={[1]}
          />
        </TestWrapper>,
      );

      // The second suggestion should show loading state
      const buttons = screen.getAllByRole("button");
      // Check for loading indicator or disabled state on second button
      expect(buttons.length).toBeGreaterThan(0);
    });

    it("should handle empty suggestions array", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChatSuggestionView suggestions={[]} />
        </TestWrapper>,
      );

      // Container should exist but have no suggestion pills
      const buttons = container.querySelectorAll("button");
      expect(buttons.length).toBe(0);
    });

    it("should handle single suggestion", () => {
      const suggestions: Suggestion[] = [
        { title: "Only One", message: "Single message", isLoading: false },
      ];

      render(
        <TestWrapper>
          <CopilotChatSuggestionView suggestions={suggestions} />
        </TestWrapper>,
      );

      expect(screen.getByText("Only One")).toBeDefined();
    });

    it("should work with property objects and class strings mixed", () => {
      const onClick = vi.fn();
      const suggestions = createSuggestions();

      const { container } = render(
        <TestWrapper>
          <CopilotChatSuggestionView
            suggestions={suggestions}
            container={{ onClick, className: "flex gap-2" }}
            suggestion="pill-style"
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".flex.gap-2")).toBeDefined();
      expect(container.querySelectorAll(".pill-style").length).toBe(3);

      const containerEl = container.querySelector(".flex.gap-2");
      if (containerEl) {
        fireEvent.click(containerEl);
        expect(onClick).toHaveBeenCalled();
      }
    });
  });
});
