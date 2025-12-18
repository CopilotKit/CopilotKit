import React from "react";
import { render, screen } from "@testing-library/react";
import { z } from "zod";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";
import CopilotChatMessageView from "../CopilotChatMessageView";
import { ActivityMessage, Message } from "@ag-ui/core";
import { ReactActivityMessageRenderer } from "@/types";

describe("CopilotChatMessageView activity rendering", () => {
  const agentId = "default";
  const threadId = "thread-test";

  function renderMessageView({
    messages,
    renderActivityMessages,
  }: {
    messages: Message[];
    renderActivityMessages?: ReactActivityMessageRenderer<any>[];
  }) {
    return render(
      <CopilotKitProvider renderActivityMessages={renderActivityMessages}>
        <CopilotChatConfigurationProvider agentId={agentId} threadId={threadId}>
          <CopilotChatMessageView messages={messages} />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    );
  }

  it("renders activity messages via matching custom renderer", () => {
    const messages: Message[] = [
      {
        id: "act-1",
        role: "activity",
        activityType: "search-progress",
        content: { percent: 42 },
      } as ActivityMessage,
    ];

    const renderers: ReactActivityMessageRenderer<{ percent: number }>[] = [
      {
        activityType: "search-progress",
        content: z.object({ percent: z.number() }),
        render: ({ content }) => (
          <div data-testid="activity-renderer">Progress: {content.percent}%</div>
        ),
      },
    ];

    renderMessageView({ messages, renderActivityMessages: renderers });

    expect(screen.getByTestId("activity-renderer").textContent).toContain("42");
  });

  it("skips rendering when no activity renderer matches", () => {
    const messages: Message[] = [
      {
        id: "act-2",
        role: "activity",
        activityType: "unknown-type",
        content: { message: "should not render" },
      } as ActivityMessage,
    ];

    renderMessageView({ messages, renderActivityMessages: [] });

    expect(screen.queryByTestId("activity-renderer")).toBeNull();
  });
});
