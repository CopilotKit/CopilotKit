import { defineComponent, ref } from "vue";
import { render, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import type { Message } from "@ag-ui/core";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";

const running = ref(true);

const renderView = (
  messages: Message[],
  props: { inlineCursor?: boolean } = {},
) =>
  render(
    defineComponent({
      components: {
        CopilotKitProvider,
        CopilotChatConfigurationProvider,
        CopilotChatMessageView,
      },
      setup() {
        return { messages, props, running };
      },
      template: `
        <CopilotKitProvider runtime-url="/api/copilotkit">
          <CopilotChatConfigurationProvider thread-id="inline-cursor">
            <CopilotChatMessageView
              :messages="messages"
              :is-running="running"
              v-bind="props"
            />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      `,
    }),
  );

const question: Message = { id: "u1", role: "user", content: "Plan it" };
const reply = (content: string): Message => ({
  id: "a1",
  role: "assistant",
  content,
});

const streamingReply = () => document.querySelector("[data-streaming-cursor]");
const anchors = () =>
  Array.from(document.querySelectorAll("[data-cursor-anchor]"));

describe("inline cursor", () => {
  it("rides on the streaming reply's text instead of below the list", async () => {
    running.value = true;
    renderView([question, reply("First step.")]);

    await waitFor(() => expect(anchors()).toHaveLength(1));
    expect(streamingReply()).not.toBeNull();
    expect(anchors()[0]!.textContent).toBe("First step.");
    expect(screen.queryByTestId("copilot-loading-cursor")).toBeNull();
  });

  it("stays below the list while waiting for the reply's first words", () => {
    running.value = true;
    renderView([question]);
    expect(screen.getByTestId("copilot-loading-cursor")).toBeDefined();
  });

  it("stays below the list with inlineCursor={false}", async () => {
    running.value = true;
    renderView([question, reply("First step.")], { inlineCursor: false });
    await waitFor(() => expect(anchors()).toHaveLength(1));
    expect(streamingReply()).toBeNull();
    expect(screen.getByTestId("copilot-loading-cursor")).toBeDefined();
  });

  it("leaves the reply once it finishes", async () => {
    running.value = true;
    renderView([question, reply("Done.")]);
    await waitFor(() => expect(streamingReply()).not.toBeNull());

    running.value = false;
    await waitFor(() => expect(streamingReply()).toBeNull());
  });

  it("marks the end of the deepest block that holds text", async () => {
    running.value = true;
    renderView([question, reply("Steps:\n\n- one\n- two\n  - nested")]);
    await waitFor(() => expect(anchors().at(-1)?.textContent).toBe("nested"));
  });
});
