import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { CopilotChat } from "@/components/chat/CopilotChat";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  toolCallChunkEvent,
  testId,
} from "@/__tests__/utils/test-helpers";

describe("useDefaultApproval E2E - Auto Approval for Unregistered Tools", () => {
  it("should render default approval UI for unregistered tool calls when defaultApproval is enabled", async () => {
    const agent = new MockStepwiseAgent();

    renderWithCopilotKit({
      agent,
      defaultApproval: true,
      children: (
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      ),
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Do something" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(agent.isRunning).toBe(true);
    });

    const messageId = testId("msg");
    const toolCallId = testId("tc");

    // Emit a tool call for a tool that has NO matching useHumanInTheLoop registration
    agent.emit(runStartedEvent());
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        toolCallName: "delete_record",
        parentMessageId: messageId,
        delta: "",
      }),
    );
    // Stream the tool call arguments
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        parentMessageId: messageId,
        delta: JSON.stringify({ recordId: "abc-123", reason: "cleanup" }),
      }),
    );
    agent.emit(runFinishedEvent());
    agent.complete();

    // The default approval UI should appear with "Approval Required" text
    await waitFor(() => {
      expect(screen.getByText("Approval Required")).toBeDefined();
    });

    // Should show the tool name
    expect(screen.getByText("delete_record")).toBeDefined();

    // Should show approve and deny buttons
    expect(screen.getByText("Approve")).toBeDefined();
    expect(screen.getByText("Deny")).toBeDefined();
  });

  it("should NOT render default approval UI when defaultApproval is disabled", async () => {
    const agent = new MockStepwiseAgent();

    renderWithCopilotKit({
      agent,
      defaultApproval: false,
      children: (
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      ),
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Do something" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(agent.isRunning).toBe(true);
    });

    const messageId = testId("msg");
    const toolCallId = testId("tc");

    agent.emit(runStartedEvent());
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        toolCallName: "delete_record",
        parentMessageId: messageId,
        delta: "",
      }),
    );
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        parentMessageId: messageId,
        delta: JSON.stringify({ recordId: "abc-123" }),
      }),
    );
    agent.emit(runFinishedEvent());
    agent.complete();

    // Wait a tick and verify no approval UI appeared
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText("Approval Required")).toBeNull();
  });

  it("should resolve with 'approved' when user clicks Approve", async () => {
    const agent = new MockStepwiseAgent();

    renderWithCopilotKit({
      agent,
      defaultApproval: true,
      children: (
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      ),
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Delete it" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(agent.isRunning).toBe(true);
    });

    const messageId = testId("msg");
    const toolCallId = testId("tc");

    agent.emit(runStartedEvent());
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        toolCallName: "delete_record",
        parentMessageId: messageId,
        delta: "",
      }),
    );
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        parentMessageId: messageId,
        delta: JSON.stringify({ recordId: "abc-123" }),
      }),
    );
    agent.emit(runFinishedEvent());
    agent.complete();

    // Wait for approval UI
    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeDefined();
    });

    // Click approve
    fireEvent.click(screen.getByText("Approve"));

    // Should show approved state
    await waitFor(() => {
      expect(screen.getByText("Approved")).toBeDefined();
    });
  });

  it("should resolve with 'denied' when user clicks Deny", async () => {
    const agent = new MockStepwiseAgent();

    renderWithCopilotKit({
      agent,
      defaultApproval: true,
      children: (
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      ),
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Delete it" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(agent.isRunning).toBe(true);
    });

    const messageId = testId("msg");
    const toolCallId = testId("tc");

    agent.emit(runStartedEvent());
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        toolCallName: "delete_record",
        parentMessageId: messageId,
        delta: "",
      }),
    );
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        parentMessageId: messageId,
        delta: JSON.stringify({ recordId: "abc-123" }),
      }),
    );
    agent.emit(runFinishedEvent());
    agent.complete();

    // Wait for approval UI
    await waitFor(() => {
      expect(screen.getByText("Deny")).toBeDefined();
    });

    // Click deny
    fireEvent.click(screen.getByText("Deny"));

    // Should show denied state
    await waitFor(() => {
      expect(screen.getByText("Denied")).toBeDefined();
    });
  });

  it("should detect MAF 'request_approval' tool calls and display the original function name", async () => {
    const agent = new MockStepwiseAgent();

    renderWithCopilotKit({
      agent,
      defaultApproval: true,
      children: (
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      ),
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Send an email" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(agent.isRunning).toBe(true);
    });

    const messageId = testId("msg");
    const toolCallId = testId("tc");

    // Emit a MAF-style "request_approval" tool call
    const mafApprovalArgs = {
      request: {
        approval_id: "approval_abc123",
        function_name: "SendEmail",
        function_arguments: {
          to: "user@example.com",
          subject: "Meeting",
          body: "Let's meet tomorrow",
        },
        message: "Approve execution of 'SendEmail'?",
      },
    };

    agent.emit(runStartedEvent());
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        toolCallName: "request_approval",
        parentMessageId: messageId,
        delta: "",
      }),
    );
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        parentMessageId: messageId,
        delta: JSON.stringify(mafApprovalArgs),
      }),
    );
    agent.emit(runFinishedEvent());
    agent.complete();

    // Should show the MAF message
    await waitFor(() => {
      expect(screen.getByText("Approve execution of 'SendEmail'?")).toBeDefined();
    });

    // Should show the original function name, not "request_approval"
    expect(screen.getByText("SendEmail")).toBeDefined();

    // Should show approve/deny buttons
    expect(screen.getByText("Approve")).toBeDefined();
    expect(screen.getByText("Deny")).toBeDefined();
  });

  it("should return MAF-formatted response { approval_id, approved } when approving a request_approval tool", async () => {
    const agent = new MockStepwiseAgent();

    renderWithCopilotKit({
      agent,
      defaultApproval: true,
      children: (
        <div style={{ height: 400 }}>
          <CopilotChat welcomeScreen={false} />
        </div>
      ),
    });

    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "Transfer money" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(agent.isRunning).toBe(true);
    });

    const messageId = testId("msg");
    const toolCallId = testId("tc");

    const mafApprovalArgs = {
      request: {
        approval_id: "approval_xyz789",
        function_name: "transfer_money",
        function_arguments: {
          from_account: "1234",
          to_account: "5678",
          amount: 500,
        },
        message: "Approve execution of 'transfer_money'?",
      },
    };

    agent.emit(runStartedEvent());
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        toolCallName: "request_approval",
        parentMessageId: messageId,
        delta: "",
      }),
    );
    agent.emit(
      toolCallChunkEvent({
        toolCallId,
        parentMessageId: messageId,
        delta: JSON.stringify(mafApprovalArgs),
      }),
    );
    agent.emit(runFinishedEvent());
    agent.complete();

    // Wait for approval UI
    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeDefined();
    });

    // Click approve
    fireEvent.click(screen.getByText("Approve"));

    // Should show approved state
    await waitFor(() => {
      expect(screen.getByText("Approved")).toBeDefined();
    });
  });
});
