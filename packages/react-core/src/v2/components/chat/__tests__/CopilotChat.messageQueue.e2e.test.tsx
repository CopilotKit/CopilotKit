import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
} from "../../../__tests__/utils/test-helpers";
import { CopilotChat } from "../CopilotChat";

/**
 * Integration coverage for the message queue feature. Focuses on the
 * user-visible surface (queue appears / pills show / feature gating).
 * The dispatch semantics (sequential/merged/manual) are unit-tested on
 * the `useMessageQueue` hook in `hooks/__tests__/use-message-queue.test.tsx`.
 */
describe("CopilotChat message queue e2e", () => {
  it("queue renders pills when messages are submitted during a run", async () => {
    const agent = new MockStepwiseAgent();
    renderWithCopilotKit({
      agent,
      children: (
        <div style={{ height: 400 }}>
          <CopilotChat
            welcomeScreen={false}
            messageQueueOptions={{ enabled: true, dispatch: "sequential" }}
          />
        </div>
      ),
    });

    // Send first message
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("first")).toBeInTheDocument();
    });

    // Simulate agent starting to generate
    agent.emit(runStartedEvent());

    // Type and send another message — should enter the queue, not trigger a new run
    fireEvent.change(input, { target: { value: "queued-one" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(
        screen.getByTestId("copilot-chat-message-queue"),
      ).toBeInTheDocument();
      // The queued pill shows the text preview
      expect(screen.getByText("queued-one")).toBeInTheDocument();
    });

    // Queue another one — two pills
    fireEvent.change(input, { target: { value: "queued-two" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("queued-one")).toBeInTheDocument();
      expect(screen.getByText("queued-two")).toBeInTheDocument();
    });
  });

  it("queued pill can be removed by the user", async () => {
    const agent = new MockStepwiseAgent();
    renderWithCopilotKit({
      agent,
      children: (
        <div style={{ height: 400 }}>
          <CopilotChat
            welcomeScreen={false}
            messageQueueOptions={{ enabled: true, dispatch: "sequential" }}
          />
        </div>
      ),
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    // Wait for the run-started state to settle
    await waitFor(() => {
      expect(screen.getByText("first")).toBeInTheDocument();
    });
    agent.emit(runStartedEvent());

    fireEvent.change(input, { target: { value: "removable" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(
        screen.getByTestId("copilot-chat-message-queue"),
      ).toBeInTheDocument();
    });

    const removeBtn = screen.getByLabelText("Remove queued message");
    fireEvent.click(removeBtn);

    await waitFor(() => {
      // Pill gone, queue UI disappears (no pills left)
      expect(
        screen.queryByTestId("copilot-chat-message-queue"),
      ).toBeNull();
    });
  });

  it("feature disabled by default: queue never renders, even during a run", async () => {
    const agent = new MockStepwiseAgent();
    renderWithCopilotKit({
      agent,
      children: (
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      ),
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    agent.emit(runStartedEvent());

    // Queue feature is off — even if user tries to send, nothing queues
    fireEvent.change(input, { target: { value: "not-queueable" } });

    expect(
      screen.queryByTestId("copilot-chat-message-queue"),
    ).toBeNull();
  });
});
