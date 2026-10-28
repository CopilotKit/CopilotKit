"use client";

import {
  useAgent,
  useConfigureSuggestions,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import { DocsChat } from "./docs-layout";

/** The same live docs assistant, embedded directly in the homepage. */
export function HomeDocsChat() {
  const { agent } = useAgent();
  const configuration = useCopilotChatConfiguration();
  const empty = agent.messages.length === 0;
  useConfigureSuggestions(
    {
      available: "before-first-message",
      suggestions: [
        {
          title: "Find my quickstart",
          message:
            "Help me connect my existing agent to my app. Find the right quickstart for my stack.",
        },
        {
          title: "Explore generative UI",
          message:
            "I want my agent to render interactive UI in my app. Help me find the right guide for my stack.",
        },
        {
          title: "Add user approvals",
          message:
            "I want my agent to ask for user approval before taking an action. Help me find the right guide.",
        },
      ],
      // Static suggestions must be reloaded after New chat clears the agent.
    },
    [configuration?.threadId, empty],
  );
  return (
    <section
      aria-label="Explore the docs"
      className="flex h-[32rem] min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-fd-border bg-fd-background shadow-sm max-sm:h-[30rem]"
    >
      <DocsChat home />
    </section>
  );
}
