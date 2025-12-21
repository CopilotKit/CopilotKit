import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { z } from "zod";
import {
  MockStepwiseAgent,
  activitySnapshotEvent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  testId,
} from "@/__tests__/utils/test-helpers";
import { ReactActivityMessageRenderer } from "@/types";
import { useCopilotKit } from "@/providers";

describe("CopilotChat activity message rendering", () => {
  it("renders custom components for activity snapshots", async () => {
    const agent = new MockStepwiseAgent();
    const agentId = "search-agent";
    agent.agentId = agentId;

    const activityRenderer: ReactActivityMessageRenderer<{ status: string; percent: number }> = {
      activityType: "search-progress",
      content: z.object({ status: z.string(), percent: z.number() }),
      render: ({ content, agent }) => (
        <div data-testid="activity-card">
          {content.status} · {content.percent}% · {agent?.agentId}
        </div>
      ),
    };

    renderWithCopilotKit({
      agents: { [agentId]: agent },
      agentId,
      renderActivityMessages: [activityRenderer],
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Start search" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Start search")).toBeDefined();
    });

    const activityMessageId = testId("activity");
    agent.emit(runStartedEvent());
    agent.emit(
      activitySnapshotEvent({
        messageId: activityMessageId,
        activityType: "search-progress",
        content: { status: "Fetching", percent: 30 },
      }),
    );
    agent.emit(runFinishedEvent());

    await waitFor(() => {
      const textContent = screen.getByTestId("activity-card").textContent ?? "";
      expect(textContent).toContain("Fetching");
      expect(textContent).toContain(agentId);
    });
  });

  it("skips unmatched activity types when no renderer exists", async () => {
    const agent = new MockStepwiseAgent();

    renderWithCopilotKit({
      agent,
      renderActivityMessages: [],
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Start search" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Start search")).toBeDefined();
    });

    const activityMessageId = testId("activity-unmatched");
    agent.emit(runStartedEvent());
    agent.emit(
      activitySnapshotEvent({
        messageId: activityMessageId,
        activityType: "unknown",
        content: { note: "no-op" },
      }),
    );
    agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.queryByTestId("activity-card")).toBeNull();
    });
  });

  it("useCopilotKit provides valid copilotkit instance inside activity message renderer", async () => {
    const agent = new MockStepwiseAgent();
    const agentId = "test-agent";
    agent.agentId = agentId;

    let capturedCopilotkit: any = "not-called";

    // Matches real-world pattern: inline arrow function with hooks
    const activityRenderer: ReactActivityMessageRenderer<{ message: string }> = {
      activityType: "test-activity",
      content: z.object({ message: z.string() }),
      render: ({ content }) => {
        const { copilotkit } = useCopilotKit();
        capturedCopilotkit = copilotkit;
        return <div data-testid="activity-render">{content.message}</div>;
      },
    };

    renderWithCopilotKit({
      agents: { [agentId]: agent },
      agentId,
      renderActivityMessages: [activityRenderer],
    });

    // Trigger user message and activity event
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Test message" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Test message")).toBeDefined();
    });

    agent.emit(runStartedEvent());
    agent.emit(
      activitySnapshotEvent({
        messageId: testId("activity"),
        activityType: "test-activity",
        content: { message: "Rendered content" },
      }),
    );
    agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId("activity-render")).toBeDefined();
    });

    // Verify context is properly propagated - copilotkit should NOT be null
    expect(capturedCopilotkit).not.toBeNull();
    expect(capturedCopilotkit).toBeDefined();
  });
});
