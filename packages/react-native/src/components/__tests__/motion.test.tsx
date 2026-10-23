import React from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  opacity: undefined as { value: number } | undefined,
  isReduceMotionEnabled: vi.fn(() => Promise.resolve(false)),
}));

// A hand-written mock like an app's own: no `Easing`, which vitest turns into
// an error the moment anything reads it.
vi.mock("react-native", async () => {
  const { Easing: _easing, ...actual } = await vi.importActual<any>(
    "../../__mocks__/react-native",
  );
  const React = require("react");
  return {
    ...actual,
    AccessibilityInfo: {
      isReduceMotionEnabled: hoisted.isReduceMotionEnabled,
      addEventListener: () => ({ remove: () => {} }),
    },
    Animated: {
      ...actual.Animated,
      View: ({ style, children }: any) => {
        hoisted.opacity = style[1].opacity;
        return React.createElement("div", null, children);
      },
    },
  };
});

describe("motion", () => {
  it("loads, with the chat UI, under a react-native mock without Easing", async () => {
    await expect(import("../motion")).resolves.toBeDefined();
    await expect(import("../CopilotChat")).resolves.toBeDefined();
  });

  it("doesn't read the reduced-motion setting while no animation can play", async () => {
    const { usePulse } = await import("../motion");
    function Pulse({ active }: { active: boolean }) {
      usePulse(900, active);
      return null;
    }

    const { rerender } = render(<Pulse active={false} />);
    await act(async () => {});
    expect(hoisted.isReduceMotionEnabled).not.toHaveBeenCalled();

    // Reduced motion, so the pulse (which needs Easing) still doesn't start.
    hoisted.isReduceMotionEnabled.mockResolvedValue(true);
    rerender(<Pulse active />);
    await act(async () => {});
    expect(hoisted.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
  });

  it("shows intro content unless the intro plays, and hides it while pending", async () => {
    const { IntroRise } = await import("../motion");

    const { rerender } = render(<IntroRise mode="off">{null}</IntroRise>);
    expect(hoisted.opacity?.value).toBe(1);

    // e.g. a bottom sheet opening: hidden until the setting is known.
    rerender(<IntroRise mode="pending">{null}</IntroRise>);
    expect(hoisted.opacity?.value).toBe(0);
  });
});
