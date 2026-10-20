/**
 * End-to-end coverage for the `humanInTheLoop` **prop** path (OSS-803).
 *
 * The unit tests in CopilotKitProvider.test.ts drive the registered renderer
 * directly. This file mounts the real pipeline instead — CopilotChat →
 * CopilotChatToolCallsView → the provider's wrapper — so the wrapper is
 * exercised as a Vue functional component and the pending-interaction key comes
 * from core's real tool call id rather than a synthesized handler context.
 */
import { defineComponent } from "vue";
import type { PropType } from "vue";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolCallStatus } from "@copilotkit/core";
import CopilotChat from "../../components/chat/CopilotChat.vue";
import {
  MockStepwiseAgent,
  renderWithCopilotKit,
  runStartedEvent,
  runFinishedEvent,
  toolCallChunkEvent,
  testId,
} from "../../__tests__/utils/test-helpers";

afterEach(() => {
  cleanup();
});

const HITLRenderer = defineComponent({
  props: {
    name: { type: String, required: true },
    description: { type: String, required: true },
    status: { type: String as PropType<ToolCallStatus>, required: true },
    args: {
      type: Object as PropType<{ action?: string }>,
      required: true,
    },
    result: { type: String, required: false },
    respond: {
      type: Function as PropType<
        ((result: unknown) => Promise<void>) | undefined
      >,
      required: false,
    },
  },
  template: `
    <div data-testid="hitl-tool">
      <div data-testid="hitl-name">{{ name }}</div>
      <div data-testid="hitl-description">{{ description }}</div>
      <div data-testid="hitl-status">{{ status }}</div>
      <div data-testid="hitl-action">{{ args.action ?? "" }}</div>
      <button
        v-if="respond"
        data-testid="hitl-approve"
        @click="respond(JSON.stringify({ approved: true }))"
      >
        Approve
      </button>
      <div v-if="result" data-testid="hitl-result">{{ result }}</div>
    </div>
  `,
});

const ChatHost = defineComponent({
  components: { CopilotChat },
  template: `
    <div style="height: 400px;">
      <CopilotChat :welcome-screen="false" />
    </div>
  `,
});

async function submitMessage(value: string) {
  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, value);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await waitFor(() => {
    expect(screen.getByText(value)).toBeDefined();
  });
}

describe("CopilotKitProvider humanInTheLoop prop E2E", () => {
  it("waits for the user and completes with the response", async () => {
    const agent = new MockStepwiseAgent();

    renderWithCopilotKit({
      agent,
      humanInTheLoop: [
        {
          name: "approvalTool",
          description: "Requires human approval",
          parameters: z.object({ action: z.string() }),
          render: HITLRenderer,
        },
      ],
      children: ChatHost,
    });

    await submitMessage("Request approval");

    await agent.emit(runStartedEvent());
    await agent.emit(
      toolCallChunkEvent({
        toolCallId: testId("tc"),
        toolCallName: "approvalTool",
        parentMessageId: testId("msg"),
        delta: JSON.stringify({ action: "delete" }),
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("hitl-status").textContent).toBe(
        ToolCallStatus.InProgress,
      );
    });
    expect(screen.getByTestId("hitl-name").textContent).toBe("approvalTool");
    expect(screen.getByTestId("hitl-description").textContent).toBe(
      "Requires human approval",
    );
    expect(screen.getByTestId("hitl-action").textContent).toBe("delete");

    await agent.emit(runFinishedEvent());
    await agent.complete();

    // The run has finished, so the tool handler is now executing. Before the
    // fix the handler had already resolved undefined, so the card never reached
    // Executing and no approve button was ever rendered.
    const approveButton = await screen.findByTestId("hitl-approve");
    expect(screen.getByTestId("hitl-status").textContent).toBe(
      ToolCallStatus.Executing,
    );

    await fireEvent.click(approveButton);

    await waitFor(() => {
      expect(screen.getByTestId("hitl-status").textContent).toBe(
        ToolCallStatus.Complete,
      );
      expect(screen.getByTestId("hitl-result").textContent).toContain(
        "approved",
      );
    });
  });

  it("passes the invoked tool name to a wildcard registration", async () => {
    const agent = new MockStepwiseAgent();

    renderWithCopilotKit({
      agent,
      humanInTheLoop: [
        {
          name: "*",
          description: "Approve any tool",
          parameters: z.object({ action: z.string() }),
          render: HITLRenderer,
        },
      ],
      children: ChatHost,
    });

    await submitMessage("Delete the file");

    await agent.emit(runStartedEvent());
    await agent.emit(
      toolCallChunkEvent({
        toolCallId: testId("tc"),
        toolCallName: "deleteFile",
        parentMessageId: testId("msg"),
        delta: JSON.stringify({ action: "delete" }),
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("hitl-name").textContent).toBe("deleteFile");
    });

    await agent.emit(runFinishedEvent());
    await agent.complete();

    const approveButton = await screen.findByTestId("hitl-approve");
    expect(screen.getByTestId("hitl-name").textContent).toBe("deleteFile");

    await fireEvent.click(approveButton);

    await waitFor(() => {
      expect(screen.getByTestId("hitl-status").textContent).toBe(
        ToolCallStatus.Complete,
      );
    });
  });
});
