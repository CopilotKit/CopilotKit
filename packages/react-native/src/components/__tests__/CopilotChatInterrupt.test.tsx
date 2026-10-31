import React from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "@copilotkit/react-core/v2/context";
import type { CopilotKitCoreReact } from "@copilotkit/react-core/v2/context";

// The shared react-native stub passes FlatList props through unused. This one
// renders the footer, which is where CopilotChat draws the interrupt element.
vi.mock("react-native", async () => {
  const actual = await vi.importActual<any>("../../__mocks__/react-native");
  return {
    ...actual,
    FlatList: ({ ListEmptyComponent, ListFooterComponent }: any) =>
      React.createElement(
        "div",
        { "data-testid": "flatlist" },
        ListEmptyComponent,
        ListFooterComponent,
      ),
  };
});

import { CopilotChat } from "../CopilotChat";
import { TestCopilotKit } from "../../__mocks__/test-copilotkit";

function CoreProbe({
  coreRef,
}: {
  coreRef: { current: CopilotKitCoreReact | null };
}) {
  coreRef.current = useCopilotKit().copilotkit;
  return null;
}

describe("CopilotChat interrupt rendering", () => {
  it("draws the interrupt element that useInterrupt publishes to core", () => {
    const coreRef: { current: CopilotKitCoreReact | null } = { current: null };
    render(
      <TestCopilotKit messages={[]}>
        <CoreProbe coreRef={coreRef} />
        <CopilotChat />
      </TestCopilotKit>,
    );
    expect(screen.queryByTestId("interrupt-ui")).toBeNull();

    act(() => {
      coreRef.current!.setInterruptElement(
        <div data-testid="interrupt-ui">Approve?</div>,
      );
    });
    expect(screen.getByTestId("interrupt-ui").textContent).toBe("Approve?");

    act(() => {
      coreRef.current!.setInterruptElement(null);
    });
    expect(screen.queryByTestId("interrupt-ui")).toBeNull();
  });
});
