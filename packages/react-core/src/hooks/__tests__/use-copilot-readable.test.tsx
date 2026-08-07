import React, { useState } from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../v2", () => ({
  useCopilotKit: vi.fn(),
}));

import { useCopilotKit } from "../../v2";
import { useCopilotReadable } from "../use-copilot-readable";

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

function createMockCopilotKit() {
  let nextId = 1;
  const entries = new Map<string, { description: string; value: string }>();

  return {
    get context() {
      return Object.fromEntries(entries);
    },
    addContext: vi.fn((item: { description: string; value: string }) => {
      const id = `ctx-${nextId++}`;
      entries.set(id, item);
      return id;
    }),
    removeContext: vi.fn((id: string) => {
      entries.delete(id);
    }),
  };
}

describe("useCopilotReadable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds context on mount and removes on unmount", () => {
    const mock = createMockCopilotKit();
    mockUseCopilotKit.mockReturnValue({ copilotkit: mock });

    const Harness: React.FC = () => {
      useCopilotReadable({ description: "test", value: "hello" });
      return null;
    };

    const { unmount } = render(<Harness />);
    expect(mock.addContext).toHaveBeenCalledWith({
      description: "test",
      value: '"hello"',
    });

    unmount();
    expect(mock.removeContext).toHaveBeenCalledWith("ctx-1");
  });

  it("removes context when available changes to disabled", () => {
    const mock = createMockCopilotKit();
    mockUseCopilotKit.mockReturnValue({ copilotkit: mock });

    let setAvailable: (v: "enabled" | "disabled") => void;

    const Harness: React.FC = () => {
      const [available, _setAvailable] = useState<"enabled" | "disabled">(
        "enabled",
      );
      setAvailable = _setAvailable;
      useCopilotReadable({ description: "test", value: "hello", available });
      return null;
    };

    render(<Harness />);
    expect(mock.addContext).toHaveBeenCalledTimes(1);

    act(() => setAvailable("disabled"));

    expect(mock.removeContext).toHaveBeenCalled();
  });

  it("cleans up on unmount when context was found (not freshly added)", () => {
    const mock = createMockCopilotKit();
    mock.addContext({ description: "test", value: '"world"' });
    mock.addContext.mockClear();

    mockUseCopilotKit.mockReturnValue({ copilotkit: mock });

    const Harness: React.FC = () => {
      useCopilotReadable({ description: "test", value: "world" });
      return null;
    };

    const { unmount } = render(<Harness />);
    expect(mock.addContext).not.toHaveBeenCalled();

    unmount();
    expect(mock.removeContext).toHaveBeenCalledWith("ctx-1");
  });

  it("does not add context when available is disabled", () => {
    const mock = createMockCopilotKit();
    mockUseCopilotKit.mockReturnValue({ copilotkit: mock });

    const Harness: React.FC = () => {
      useCopilotReadable({
        description: "test",
        value: "hello",
        available: "disabled",
      });
      return null;
    };

    render(<Harness />);
    expect(mock.addContext).not.toHaveBeenCalled();
  });

  it("uses custom convert function", () => {
    const mock = createMockCopilotKit();
    mockUseCopilotKit.mockReturnValue({ copilotkit: mock });

    const convert = (_desc: string, val: any) => `custom:${val}`;

    const Harness: React.FC = () => {
      useCopilotReadable({
        description: "test",
        value: 42,
        convert,
      });
      return null;
    };

    render(<Harness />);
    expect(mock.addContext).toHaveBeenCalledWith({
      description: "test",
      value: "custom:42",
    });
  });
});
