// Docs-only snippet — not imported or rendered. The actual route is served
// by page.tsx, which carries QA hooks (frontend tools, render tools, agent
// context) that aren't relevant to the prebuilt-chat docs page. This file
// gives the docs a minimal Chat definition to point at via the
// chat-component region without disturbing the runtime demo.
//
// Why a sibling file: the bundler walks every file in the demo folder and
// extracts region markers from each, so a docs-targeted teaching example
// can live alongside the production demo without being wired into the
// route. See: showcase/scripts/bundle-demo-content.ts.

import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

// @region[chat-component]
export function Chat() {
  useConfigureSuggestions({
    suggestions: [
      { title: "Write a sonnet", message: "Write a short sonnet about AI." },
    ],
    available: "always",
  });

  return <CopilotChat agentId="agentic_chat" className="h-full rounded-2xl" />;
}
// @endregion[chat-component]
