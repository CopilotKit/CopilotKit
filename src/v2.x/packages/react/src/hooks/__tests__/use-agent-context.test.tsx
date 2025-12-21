import React, { useState } from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAgentContext, type AgentContextInput } from "../use-agent-context";
import { useCopilotKit } from "@/providers/CopilotKitProvider";

// Mock the CopilotKitProvider
vi.mock("@/providers/CopilotKitProvider", () => ({
  useCopilotKit: vi.fn(),
}));

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

describe("useAgentContext", () => {
  let addContextMock: ReturnType<typeof vi.fn>;
  let removeContextMock: ReturnType<typeof vi.fn>;
  let contextIdCounter: number;

  beforeEach(() => {
    contextIdCounter = 0;
    addContextMock = vi.fn(() => `context-${++contextIdCounter}`);
    removeContextMock = vi.fn();

    mockUseCopilotKit.mockReturnValue({
      copilotkit: {
        addContext: addContextMock,
        removeContext: removeContextMock,
      },
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("context cleanup on unmount", () => {
    it("removes the context when the component unmounts", () => {
      const TestComponent: React.FC<{ context: AgentContextInput }> = ({
        context,
      }) => {
        useAgentContext(context);
        return <div>Test</div>;
      };

      const { unmount } = render(
        <TestComponent
          context={{ description: "test context", value: "test value" }}
        />
      );

      // Context should be added
      expect(addContextMock).toHaveBeenCalledTimes(1);
      expect(addContextMock).toHaveBeenCalledWith({
        description: "test context",
        value: "test value",
      });

      const addedContextId = addContextMock.mock.results[0]?.value;

      // Unmount the component
      unmount();

      // Context should be removed with the correct ID
      expect(removeContextMock).toHaveBeenCalledTimes(1);
      expect(removeContextMock).toHaveBeenCalledWith(addedContextId);
    });

    it("removes context when conditionally unmounted", () => {
      const ContextUser: React.FC = () => {
        useAgentContext({
          description: "conditional context",
          value: "conditional value",
        });
        return <div data-testid="context-user">Context User</div>;
      };

      const ParentComponent: React.FC = () => {
        const [showContext, setShowContext] = useState(true);
        return (
          <>
            <button
              data-testid="toggle"
              onClick={() => setShowContext((prev) => !prev)}
            >
              Toggle
            </button>
            {showContext && <ContextUser />}
          </>
        );
      };

      const { getByTestId, queryByTestId } = render(<ParentComponent />);

      // Context should be added
      expect(addContextMock).toHaveBeenCalledTimes(1);
      expect(queryByTestId("context-user")).not.toBeNull();

      const addedContextId = addContextMock.mock.results[0]?.value;

      // Toggle off - should unmount ContextUser
      act(() => {
        getByTestId("toggle").click();
      });

      // Context should be removed
      expect(removeContextMock).toHaveBeenCalledTimes(1);
      expect(removeContextMock).toHaveBeenCalledWith(addedContextId);
      expect(queryByTestId("context-user")).toBeNull();
    });
  });

  describe("re-render idempotence", () => {
    it("does not add additional context on re-render with same values", () => {
      const TestComponent: React.FC<{
        context: AgentContextInput;
        counter: number;
      }> = ({ context, counter }) => {
        useAgentContext(context);
        return <div>Counter: {counter}</div>;
      };

      const context: AgentContextInput = {
        description: "stable context",
        value: "stable value",
      };

      const { rerender } = render(
        <TestComponent context={context} counter={0} />
      );

      // Initial render - context added once
      expect(addContextMock).toHaveBeenCalledTimes(1);

      // Re-render with different counter but same context
      rerender(<TestComponent context={context} counter={1} />);

      // Context should not be added again
      expect(addContextMock).toHaveBeenCalledTimes(1);

      // Re-render again
      rerender(<TestComponent context={context} counter={2} />);

      // Still only one add
      expect(addContextMock).toHaveBeenCalledTimes(1);
    });

    it("does not add additional context when parent re-renders", () => {
      const ContextUser: React.FC = () => {
        useAgentContext({
          description: "child context",
          value: "child value",
        });
        return <div>Child</div>;
      };

      const ParentComponent: React.FC = () => {
        const [counter, setCounter] = useState(0);
        return (
          <>
            <button data-testid="increment" onClick={() => setCounter((c) => c + 1)}>
              Increment ({counter})
            </button>
            <ContextUser />
          </>
        );
      };

      const { getByTestId } = render(<ParentComponent />);

      // Initial render
      expect(addContextMock).toHaveBeenCalledTimes(1);

      // Trigger parent re-render multiple times
      act(() => {
        getByTestId("increment").click();
      });
      act(() => {
        getByTestId("increment").click();
      });
      act(() => {
        getByTestId("increment").click();
      });

      // Context should still only be added once
      expect(addContextMock).toHaveBeenCalledTimes(1);
      // No removals should have happened
      expect(removeContextMock).toHaveBeenCalledTimes(0);
    });

    it("re-adds context when description changes", () => {
      const TestComponent: React.FC<{ description: string }> = ({
        description,
      }) => {
        useAgentContext({ description, value: "same value" });
        return <div>{description}</div>;
      };

      const { rerender } = render(<TestComponent description="first" />);

      expect(addContextMock).toHaveBeenCalledTimes(1);
      expect(addContextMock).toHaveBeenLastCalledWith({
        description: "first",
        value: "same value",
      });

      const firstContextId = addContextMock.mock.results[0]?.value;

      // Change description
      rerender(<TestComponent description="second" />);

      // Old context removed, new context added
      expect(removeContextMock).toHaveBeenCalledTimes(1);
      expect(removeContextMock).toHaveBeenCalledWith(firstContextId);
      expect(addContextMock).toHaveBeenCalledTimes(2);
      expect(addContextMock).toHaveBeenLastCalledWith({
        description: "second",
        value: "same value",
      });
    });

    it("re-adds context when value changes", () => {
      const TestComponent: React.FC<{ value: string }> = ({ value }) => {
        useAgentContext({ description: "same description", value });
        return <div>{value}</div>;
      };

      const { rerender } = render(<TestComponent value="first" />);

      expect(addContextMock).toHaveBeenCalledTimes(1);
      const firstContextId = addContextMock.mock.results[0]?.value;

      // Change value
      rerender(<TestComponent value="second" />);

      // Old context removed, new context added
      expect(removeContextMock).toHaveBeenCalledTimes(1);
      expect(removeContextMock).toHaveBeenCalledWith(firstContextId);
      expect(addContextMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("JSON serialization", () => {
    it("passes string values through unchanged", () => {
      const TestComponent: React.FC = () => {
        useAgentContext({
          description: "string context",
          value: "plain string value",
        });
        return null;
      };

      render(<TestComponent />);

      expect(addContextMock).toHaveBeenCalledWith({
        description: "string context",
        value: "plain string value",
      });
    });

    it("serializes object values to JSON", () => {
      const TestComponent: React.FC = () => {
        useAgentContext({
          description: "object context",
          value: { name: "John", age: 30 },
        });
        return null;
      };

      render(<TestComponent />);

      expect(addContextMock).toHaveBeenCalledWith({
        description: "object context",
        value: '{"name":"John","age":30}',
      });
    });

    it("serializes array values to JSON", () => {
      const TestComponent: React.FC = () => {
        useAgentContext({
          description: "array context",
          value: [1, 2, 3, "four"],
        });
        return null;
      };

      render(<TestComponent />);

      expect(addContextMock).toHaveBeenCalledWith({
        description: "array context",
        value: '[1,2,3,"four"]',
      });
    });

    it("serializes number values to JSON", () => {
      const TestComponent: React.FC = () => {
        useAgentContext({
          description: "number context",
          value: 42,
        });
        return null;
      };

      render(<TestComponent />);

      expect(addContextMock).toHaveBeenCalledWith({
        description: "number context",
        value: "42",
      });
    });

    it("serializes boolean values to JSON", () => {
      const TestComponent: React.FC = () => {
        useAgentContext({
          description: "boolean context",
          value: true,
        });
        return null;
      };

      render(<TestComponent />);

      expect(addContextMock).toHaveBeenCalledWith({
        description: "boolean context",
        value: "true",
      });
    });

    it("serializes null values to JSON", () => {
      const TestComponent: React.FC = () => {
        useAgentContext({
          description: "null context",
          value: null,
        });
        return null;
      };

      render(<TestComponent />);

      expect(addContextMock).toHaveBeenCalledWith({
        description: "null context",
        value: "null",
      });
    });

    it("serializes nested objects to JSON", () => {
      const TestComponent: React.FC = () => {
        useAgentContext({
          description: "nested context",
          value: {
            user: {
              name: "Alice",
              settings: {
                theme: "dark",
                notifications: true,
              },
            },
            items: [1, 2, { nested: "value" }],
          },
        });
        return null;
      };

      render(<TestComponent />);

      expect(addContextMock).toHaveBeenCalledWith({
        description: "nested context",
        value: '{"user":{"name":"Alice","settings":{"theme":"dark","notifications":true}},"items":[1,2,{"nested":"value"}]}',
      });
    });
  });

  describe("copilotkit not available", () => {
    it("does nothing when copilotkit is null", () => {
      mockUseCopilotKit.mockReturnValue({
        copilotkit: null,
      } as any);

      const TestComponent: React.FC = () => {
        useAgentContext({
          description: "test",
          value: "test",
        });
        return null;
      };

      const { unmount } = render(<TestComponent />);

      // Should not throw and should not call addContext
      expect(addContextMock).not.toHaveBeenCalled();

      unmount();

      // Should not call removeContext either
      expect(removeContextMock).not.toHaveBeenCalled();
    });
  });
});
