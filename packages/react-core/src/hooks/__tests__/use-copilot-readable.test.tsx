import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCopilotReadable } from "../use-copilot-readable";

const mockAddContext = vi.fn().mockReturnValue("test-ctx-id");
const mockRemoveContext = vi.fn();
const mockContext: Record<string, any> = {};

vi.mock("../v2", () => ({
  useCopilotKit: () => ({
    copilotkit: {
      context: mockContext,
      addContext: mockAddContext,
      removeContext: mockRemoveContext,
    },
  }),
}));

describe("useCopilotReadable", () => {
  it("invokes custom convert function with description and value parameters", () => {
    const convertSpy = vi.fn().mockImplementation((desc: string, val: any) => `${desc}: ${JSON.stringify(val)}`);

    renderHook(() =>
      useCopilotReadable({
        description: "The list of employees",
        value: { employees: ["Alice", "Bob"] },
        convert: convertSpy,
      })
    );

    expect(convertSpy).toHaveBeenCalledWith("The list of employees", { employees: ["Alice", "Bob"] });
    expect(mockAddContext).toHaveBeenCalledWith({
      description: "The list of employees",
      value: 'The list of employees: {"employees":["Alice","Bob"]}',
    });
  });

  it("re-triggers effect when custom dependencies change", () => {
    let dep = 1;
    const { rerender } = renderHook(
      ({ deps }) =>
        useCopilotReadable(
          {
            description: "Dynamic State",
            value: { count: dep },
          },
          deps
        ),
      { initialProps: { deps: [dep] } }
    );

    expect(mockAddContext).toHaveBeenCalledTimes(1);

    dep = 2;
    rerender({ deps: [dep] });

    expect(mockAddContext).toHaveBeenCalledTimes(2);
  });
});
