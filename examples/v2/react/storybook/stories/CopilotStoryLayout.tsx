import React from "react";

import { CopilotChatConfigurationProvider, CopilotKitProvider } from "@copilotkitnext/react";

interface CopilotStoryLayoutProps {
  children: React.ReactNode;
  threadId?: string;
  isModalDefaultOpen?: boolean;
  content?: React.ReactNode;
}

const defaultContent = (
  <>
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">Project Dashboard</h1>
      <p className="text-muted-foreground">
        Toggle the assistant to draft updates, summarize discussions, and keep track of action items while you stay in
        context.
      </p>
    </section>

    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <article
          key={index}
          className="rounded-xl border border-border bg-card p-4 shadow-sm transition hover:shadow-md"
        >
          <h2 className="text-lg font-medium">Task {index + 1}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Placeholder content to illustrate how the assistant integrates alongside your existing workflow.
          </p>
        </article>
      ))}
    </div>
  </>
);

class MockAgent {}

export const CopilotStoryLayout: React.FC<CopilotStoryLayoutProps> = ({
  children,
  threadId = "story-copilot-layout",
  isModalDefaultOpen = true,
  content,
}) => (
  <CopilotKitProvider runtimeUrl="https://copilotkit.ai">
    <CopilotChatConfigurationProvider threadId={"123"} isModalDefaultOpen={isModalDefaultOpen}>
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 px-6 py-10">{content ?? defaultContent}</div>
        {children}
      </div>
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

export default CopilotStoryLayout;
