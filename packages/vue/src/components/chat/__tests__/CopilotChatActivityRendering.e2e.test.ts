import { cleanup, fireEvent, screen, waitFor } from "@testing-library/vue";
import { defineComponent } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import CopilotChat from "../CopilotChat.vue";
import { useCopilotKit } from "../../../providers/useCopilotKit";
import {
  activitySnapshotEvent,
  MockStepwiseAgent,
  renderWithCopilotKit,
  runFinishedEvent,
  runStartedEvent,
  testId,
} from "../../../__tests__/utils/test-helpers";

async function submitMessageAndWaitForUserMessage(value: string) {
  await waitFor(() => {
    expect(screen.queryByTestId("copilot-chat-cursor")).toBeNull();
  });

  const input = await screen.findByRole("textbox");
  await fireEvent.update(input, value);
  await fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

  await waitFor(() => {
    expect(screen.getByText(value)).toBeDefined();
  });
}

const CopilotkitProbe = defineComponent({
  setup() {
    const { copilotkit } = useCopilotKit();
    return { copilotkit };
  },
  template: `
    <div data-testid="copilotkit-probe">
      {{ String(!!copilotkit) }}
    </div>
  `,
});

afterEach(() => {
  cleanup();
});

describe("CopilotChat activity message rendering", () => {
  it("renders custom components for activity snapshots", async () => {
    const agent = new MockStepwiseAgent();
    const agentId = "search-agent";
    agent.agentId = agentId;

    const Host = defineComponent({
      components: { CopilotChat },
      template: `
        <CopilotChat :welcome-screen="false">
          <template #activity-search-progress="{ content, agent }">
            <div data-testid="activity-card">
              {{ String(content?.status ?? "") }} · {{ String(content?.percent ?? "") }}% · {{ String(agent?.agentId ?? "") }}
            </div>
          </template>
        </CopilotChat>
      `,
    });

    renderWithCopilotKit({
      agent,
      agentId,
      children: Host,
    });

    await submitMessageAndWaitForUserMessage("Start search");

    await agent.emit(runStartedEvent());
    await agent.emit(
      activitySnapshotEvent({
        messageId: testId("activity"),
        activityType: "search-progress",
        content: { status: "Fetching", percent: 30 },
      }),
    );
    await agent.emit(runFinishedEvent());
    await waitFor(() => {
      const textContent = screen.getByTestId("activity-card").textContent ?? "";
      expect(textContent).toContain("Fetching");
      expect(textContent).toContain(agentId);
    });
  });

  it("skips unmatched activity types when no renderer exists", async () => {
    const agent = new MockStepwiseAgent();
    renderWithCopilotKit({ agent });

    await submitMessageAndWaitForUserMessage("Start search");

    await agent.emit(runStartedEvent());
    await agent.emit(
      activitySnapshotEvent({
        messageId: testId("activity-unmatched"),
        activityType: "unknown",
        content: { note: "no-op" },
      }),
    );
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.queryByTestId("activity-card")).toBeNull();
    });
  });

  it("useCopilotKit provides valid copilotkit instance inside activity message renderer", async () => {
    const agent = new MockStepwiseAgent();
    const agentId = "test-agent";
    agent.agentId = agentId;

    const Host = defineComponent({
      components: { CopilotChat, CopilotkitProbe },
      template: `
        <CopilotChat :welcome-screen="false">
          <template #activity-test-activity="{ content }">
            <div data-testid="activity-render">
              {{ String(content?.message ?? "") }}
              <CopilotkitProbe />
            </div>
          </template>
        </CopilotChat>
      `,
    });

    renderWithCopilotKit({
      agent,
      agentId,
      children: Host,
    });

    await submitMessageAndWaitForUserMessage("Test message");

    await agent.emit(runStartedEvent());
    await agent.emit(
      activitySnapshotEvent({
        messageId: testId("activity"),
        activityType: "test-activity",
        content: { message: "Rendered content" },
      }),
    );
    await agent.emit(runFinishedEvent());

    await waitFor(() => {
      expect(screen.getByTestId("activity-render")).toBeDefined();
    });

    expect(screen.getByTestId("copilotkit-probe").textContent).toBe("true");
  });
});
