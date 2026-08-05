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

describe("useCopilotReadable available & unmount cleanup", () => {
  it("removes context on unmount when found branch was hit", () => {
    mockContext["test-ctx-id"] = {
      description: "Existing Data",
      value: '"hello"',
    };

    const { unmount } = renderHook(() =>
      useCopilotReadable({
        description: "Existing Data",
        value: "hello",
      })
    );

    unmount();

    expect(mockRemoveContext).toHaveBeenCalledWith("test-ctx-id");
  });

  it("removes context when available toggles to disabled", () => {
    let availableStatus: "enabled" | "disabled" = "enabled";
    const { rerender } = renderHook(
      ({ available }) =>
        useCopilotReadable({
          description: "Toggle Data",
          value: "world",
          available,
        }),
      { initialProps: { available: availableStatus } }
    );

    availableStatus = "disabled";
    rerender({ available: availableStatus });

    expect(mockRemoveContext).toHaveBeenCalled();
  });
});
