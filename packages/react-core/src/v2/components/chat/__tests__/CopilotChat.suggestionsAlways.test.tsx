import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { useConfigureSuggestions } from "../../../hooks/use-configure-suggestions";
import { CopilotChat } from "../CopilotChat";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import {
  MockStepwiseAgent,
  runStartedEvent,
  runFinishedEvent,
  textChunkEvent,
  testId,
} from "../../../__tests__/utils/test-helpers";
import type { AutoScrollMode } from "../normalize-auto-scroll";

// jsdom doesn't implement scrollTo; pin-to-send mode calls it from a rAF
// callback, so without this stub the cleanup throws an unhandled error.
beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
});

const STATIC_SUGGESTIONS = [
  { title: "Say hello", message: "Hello there!" },
  { title: "Get help", message: "Can you help me?" },
];

const ChatWithStaticAlwaysSuggestions: React.FC<{
  autoScroll?: AutoScrollMode | boolean;
  consumerAgentId?: string;
}> = ({ autoScroll, consumerAgentId }) => {
  useConfigureSuggestions({
    suggestions: STATIC_SUGGESTIONS,
    available: "always",
    ...(consumerAgentId ? { consumerAgentId } : {}),
  });

  return <CopilotChat autoScroll={autoScroll} />;
};

function renderChat({
  agent,
  autoScroll,
  consumerAgentId,
}: {
  agent: MockStepwiseAgent;
  autoScroll?: AutoScrollMode | boolean;
  consumerAgentId?: string;
}) {
  return render(
    <CopilotKitProvider agents__unsafe_dev_only={{ default: agent }}>
      <div style={{ height: 400 }}>
        <ChatWithStaticAlwaysSuggestions
          autoScroll={autoScroll}
          consumerAgentId={consumerAgentId}
        />
      </div>
    </CopilotKitProvider>,
  );
}

describe("CopilotChat - static suggestions with available:'always'", () => {
  it("should show suggestions on the welcome screen", async () => {
    const agent = new MockStepwiseAgent();
    renderChat({ agent, consumerAgentId: "default" });

    await waitFor(() => {
      expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText("Say hello")).toBeDefined();
      expect(screen.getByText("Get help")).toBeDefined();
    });
  });

  it("should show suggestions on the welcome screen with global config (no consumerAgentId)", async () => {
    const agent = new MockStepwiseAgent();
    renderChat({ agent });

    await waitFor(() => {
      expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText("Say hello")).toBeDefined();
      expect(screen.getByText("Get help")).toBeDefined();
    });
  });

  it("should hide suggestions during a run and restore them after", async () => {
    const agent = new MockStepwiseAgent();
    renderChat({ agent, consumerAgentId: "default" });

    await waitFor(() => {
      expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText("Say hello")).toBeDefined();
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Hi!" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Hi!")).toBeDefined();
    });

    const messageId = testId("msg");
    agent.emit(runStartedEvent());
    agent.emit(textChunkEvent(messageId, "Hello! How can I help?"));

    // While the run is in flight, suggestions should be hidden — every run
    // changes the conversation context, so we wait for the end-of-run reload
    // before showing them again.
    await waitFor(() => {
      expect(screen.queryByText("Say hello")).toBeNull();
      expect(screen.queryByText("Get help")).toBeNull();
    });

    agent.emit(runFinishedEvent());
    agent.complete();

    await waitFor(() => {
      expect(screen.getByText("Hello! How can I help?")).toBeDefined();
    });

    // After the run, the static "always" config repopulates them.
    await waitFor(
      () => {
        expect(screen.getByText("Say hello")).toBeDefined();
        expect(screen.getByText("Get help")).toBeDefined();
      },
      { timeout: 3000 },
    );
  });

  it("should hide suggestions during a run in pin-to-send mode", async () => {
    const agent = new MockStepwiseAgent();
    renderChat({ agent, autoScroll: "pin-to-send" });

    await waitFor(() => {
      expect(screen.getByTestId("copilot-welcome-screen")).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByText("Say hello")).toBeDefined();
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Hi!" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Hi!")).toBeDefined();
    });

    const messageId = testId("msg");
    agent.emit(runStartedEvent());
    agent.emit(textChunkEvent(messageId, "Hello! How can I help?"));

    await waitFor(() => {
      expect(screen.queryByText("Say hello")).toBeNull();
      expect(screen.queryByText("Get help")).toBeNull();
    });

    agent.emit(runFinishedEvent());
    agent.complete();

    await waitFor(() => {
      expect(screen.getByText("Hello! How can I help?")).toBeDefined();
    });

    await waitFor(
      () => {
        expect(screen.getByText("Say hello")).toBeDefined();
        expect(screen.getByText("Get help")).toBeDefined();
      },
      { timeout: 3000 },
    );
  });
});
