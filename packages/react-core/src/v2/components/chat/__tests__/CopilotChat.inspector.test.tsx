import React, { useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotChat } from "../CopilotChat";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { MockStepwiseAgent } from "../../../__tests__/utils/test-helpers";
import { stubWindowLocation } from "../../../../v1-deprecated/test-helpers/stub-window-location";

function InspectorMessage() {
  return (
    <CopilotChatAssistantMessage
      message={{ id: "message", role: "assistant", content: "Inspect me" }}
    />
  );
}

function TestChat({
  providerPreference,
  chatPreference,
  sibling = false,
}: {
  providerPreference?: boolean;
  chatPreference?: boolean;
  sibling?: boolean;
}) {
  const [agents] = useState(() => ({ default: new MockStepwiseAgent() }));
  return (
    <CopilotKitProvider
      agents__unsafe_dev_only={agents}
      enableInspector={providerPreference}
    >
      <div data-testid="chat">
        <CopilotChat
          inspectorTools={chatPreference}
          welcomeScreen={false}
          children={InspectorMessage}
        />
      </div>
      {sibling && (
        <div data-testid="sibling">
          <CopilotChat welcomeScreen={false} children={InspectorMessage} />
        </div>
      )}
    </CopilotKitProvider>
  );
}

afterEach(() => vi.unstubAllEnvs());

describe("CopilotChat inspectorTools", () => {
  it.each([
    [undefined, undefined, true],
    [undefined, true, true],
    [undefined, false, false],
    [true, undefined, true],
    [true, true, true],
    [true, false, true],
    [false, undefined, false],
    [false, true, false],
    [false, false, false],
  ])(
    "provider=%s, chat=%s produces visible=%s",
    async (providerPreference, chatPreference, visible) => {
      vi.stubEnv("NODE_ENV", "development");
      render(
        <TestChat
          providerPreference={providerPreference}
          chatPreference={chatPreference}
        />,
      );
      await act(async () => {});
      expect(!!screen.queryByTestId("copilot-inspector-button")).toBe(visible);
    },
  );

  it("updates chat preferences without affecting a sibling or the shared Inspector", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { rerender } = render(<TestChat chatPreference={false} sibling />);
    await act(async () => {});
    expect(
      within(screen.getByTestId("chat")).queryByTestId(
        "copilot-inspector-button",
      ),
    ).toBeNull();
    expect(
      within(screen.getByTestId("sibling")).getByTestId(
        "copilot-inspector-button",
      ),
    ).toBeDefined();
    expect(document.querySelector("cpk-web-inspector")).not.toBeNull();

    rerender(<TestChat chatPreference={true} sibling />);
    expect(screen.getAllByTestId("copilot-inspector-button")).toHaveLength(2);
    rerender(
      <TestChat providerPreference={false} chatPreference={true} sibling />,
    );
    await act(async () => {});
    expect(screen.queryByTestId("copilot-inspector-button")).toBeNull();
    rerender(
      <TestChat providerPreference={true} chatPreference={false} sibling />,
    );
    await act(async () => {});
    expect(screen.getAllByTestId("copilot-inspector-button")).toHaveLength(2);
  });

  it.each([
    ["production", "http://localhost:3000"],
    ["development", "https://preview.example.com"],
  ])("cannot enable shortcuts in %s at %s", async (environment, url) => {
    vi.stubEnv("NODE_ENV", environment);
    const restore = stubWindowLocation(url);
    try {
      render(<TestChat providerPreference={true} chatPreference={true} />);
      await act(async () => {});
      expect(screen.queryByTestId("copilot-inspector-button")).toBeNull();
      expect(document.querySelector("cpk-web-inspector")).toBeNull();
    } finally {
      restore();
    }
  });

  it("respects Inspector dismissal and restoration even when both props are true", async () => {
    vi.stubEnv("NODE_ENV", "development");
    render(<TestChat providerPreference={true} chatPreference={true} />);
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const inspector = document.querySelector("cpk-web-inspector")!;
    expect(screen.getByTestId("copilot-inspector-button")).toBeDefined();
    for (const visible of [false, true]) {
      act(() => {
        inspector.dispatchEvent(
          new CustomEvent("cpk-inspector-visibility-change", {
            detail: { visible },
          }),
        );
      });
      expect(!!screen.queryByTestId("copilot-inspector-button")).toBe(visible);
    }
  });
});
