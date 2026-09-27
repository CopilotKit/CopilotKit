import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import type { AssistantMessage, Message } from "@ag-ui/core";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { CopilotChatAssistantMessage } from "../CopilotChatAssistantMessage";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";

const renderView = (
  messages: Message[],
  props: Partial<React.ComponentProps<typeof CopilotChatMessageView>> = {},
) =>
  render(
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider threadId="inline-cursor">
        <CopilotChatMessageView messages={messages} isRunning {...props} />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
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
    renderView([question, reply("First step.")]);

    await waitFor(() => expect(anchors()).toHaveLength(1));
    expect(streamingReply()).not.toBeNull();
    expect(anchors()[0]!.textContent).toBe("First step.");
    expect(screen.queryByTestId("copilot-loading-cursor")).toBeNull();
  });

  it("stays below the list while waiting for the reply's first words", () => {
    renderView([question]);
    expect(screen.getByTestId("copilot-loading-cursor")).toBeDefined();
  });

  it("stays below the list with inlineCursor={false}", async () => {
    renderView([question, reply("First step.")], { inlineCursor: false });
    await waitFor(() => expect(anchors()).toHaveLength(1));
    expect(streamingReply()).toBeNull();
    expect(screen.getByTestId("copilot-loading-cursor")).toBeDefined();
  });

  it("leaves the reply once it finishes", async () => {
    const { rerender } = renderView([question, reply("Done.")]);
    await waitFor(() => expect(streamingReply()).not.toBeNull());

    rerender(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider threadId="inline-cursor">
          <CopilotChatMessageView
            messages={[question, reply("Done.")]}
            isRunning={false}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
    expect(streamingReply()).toBeNull();
  });

  it.each([
    { name: "a custom cursor slot", props: { cursor: "custom-cursor" } },
    {
      name: "a custom assistant message component",
      props: {
        assistantMessage: ({ message }: { message: Message }) => (
          <div>{String(message.content)}</div>
        ),
      },
    },
    {
      name: "an assistant message children render prop",
      props: {
        assistantMessage: {
          children: ({
            markdownRenderer,
          }: {
            markdownRenderer: React.ReactNode;
          }) => <div>{markdownRenderer}</div>,
        },
      },
    },
  ])("stays below the list with $name", async ({ props }) => {
    renderView(
      [question, reply("First step.")],
      props as Partial<React.ComponentProps<typeof CopilotChatMessageView>>,
    );
    await waitFor(() =>
      expect(screen.getByText("First step.", { exact: false })).toBeDefined(),
    );
    expect(streamingReply()).toBeNull();
    expect(screen.getByTestId("copilot-loading-cursor")).toBeDefined();
  });

  it("applies a custom cursor slot to the list-level cursor", () => {
    renderView([question, reply("First step.")], { cursor: "custom-cursor" });
    expect(screen.getByTestId("copilot-loading-cursor").className).toContain(
      "custom-cursor",
    );
  });

  it("passes showCursor to the assistant message children render prop", () => {
    const seen: Array<boolean | undefined> = [];
    render(
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider threadId="inline-cursor">
          <CopilotChatAssistantMessage
            message={reply("Writing…") as AssistantMessage}
            showCursor
          >
            {({ showCursor }) => {
              seen.push(showCursor);
              return <div />;
            }}
          </CopilotChatAssistantMessage>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
    expect(seen.at(-1)).toBe(true);
  });

  it("marks the end of the deepest block that holds text", async () => {
    renderView([question, reply("Steps:\n\n- one\n- two\n  - nested")]);
    await waitFor(() => expect(anchors().at(-1)?.textContent).toBe("nested"));
  });
});
