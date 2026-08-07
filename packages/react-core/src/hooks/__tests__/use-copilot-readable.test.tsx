import { vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { useCopilotReadable } from "../use-copilot-readable";

interface FakeCopilotKit {
  context: Record<string, { description: string; value: string }>;
  addContext: ReturnType<typeof vi.fn>;
  removeContext: ReturnType<typeof vi.fn>;
}

let copilotkit: FakeCopilotKit;

function createFakeCopilotKit(): FakeCopilotKit {
  const context: FakeCopilotKit["context"] = {};
  let nextId = 0;
  return {
    context,
    addContext: vi.fn(({ description, value }) => {
      const id = `ctx-${++nextId}`;
      context[id] = { description, value };
      return id;
    }),
    removeContext: vi.fn((id: string) => {
      delete context[id];
    }),
  };
}

vi.mock("../../v2", () => ({
  useCopilotKit: () => ({ copilotkit }),
}));

describe("useCopilotReadable", () => {
  beforeEach(() => {
    copilotkit = createFakeCopilotKit();
  });

  describe("convert", () => {
    it("calls convert with (description, value)", () => {
      const convert = vi.fn(() => "converted");
      const value = { employees: ["Alice", "Bob"] };

      const Component: React.FC = () => {
        useCopilotReadable({
          description: "The list of employees",
          value,
          convert,
        });
        return null;
      };

      render(<Component />);

      expect(convert).toHaveBeenCalledWith("The list of employees", value);
    });

    it("stores the string returned by convert", () => {
      const Component: React.FC = () => {
        useCopilotReadable({
          description: "The list of employees",
          value: { employees: ["Alice"] },
          convert: (description, value) =>
            `${description}: ${JSON.stringify(value)}`,
        });
        return null;
      };

      render(<Component />);

      expect(copilotkit.addContext).toHaveBeenCalledWith({
        description: "The list of employees",
        value: 'The list of employees: {"employees":["Alice"]}',
      });
    });

    it("falls back to JSON.stringify when convert is omitted", () => {
      const Component: React.FC = () => {
        useCopilotReadable({
          description: "The list of employees",
          value: { employees: ["Alice"] },
        });
        return null;
      };

      render(<Component />);

      expect(copilotkit.addContext).toHaveBeenCalledWith({
        description: "The list of employees",
        value: '{"employees":["Alice"]}',
      });
    });
  });

  describe("dependencies", () => {
    it("re-registers the context when a dependency changes", () => {
      const value = { count: 0 };

      const Component: React.FC<{ dep: number }> = ({ dep }) => {
        useCopilotReadable({ description: "Counter", value }, [dep]);
        return null;
      };

      const { rerender } = render(<Component dep={1} />);
      expect(copilotkit.addContext).toHaveBeenCalledTimes(1);

      rerender(<Component dep={2} />);
      expect(copilotkit.addContext).toHaveBeenCalledTimes(2);
    });

    it("does not re-register when no dependency changes", () => {
      const value = { count: 0 };

      const Component: React.FC<{ unrelated: number }> = ({ unrelated }) => {
        useCopilotReadable({ description: "Counter", value }, [1]);
        return <span>{unrelated}</span>;
      };

      const { rerender } = render(<Component unrelated={1} />);
      rerender(<Component unrelated={2} />);

      expect(copilotkit.addContext).toHaveBeenCalledTimes(1);
    });
  });

  describe("available", () => {
    it("does not register the context when disabled", () => {
      const Component: React.FC = () => {
        useCopilotReadable({
          description: "Counter",
          value: { count: 0 },
          available: "disabled",
        });
        return null;
      };

      render(<Component />);

      expect(copilotkit.addContext).not.toHaveBeenCalled();
    });
  });

  it("removes the context on unmount", () => {
    const Component: React.FC = () => {
      useCopilotReadable({ description: "Counter", value: { count: 0 } });
      return null;
    };

    const { unmount } = render(<Component />);
    const id = copilotkit.addContext.mock.results[0]?.value;

    unmount();

    expect(copilotkit.removeContext).toHaveBeenCalledWith(id);
  });
});
