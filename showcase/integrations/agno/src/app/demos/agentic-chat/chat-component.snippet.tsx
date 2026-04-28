// Docs-only snippet — not imported or rendered. The actual route is served
// by page.tsx, which carries QA hooks (frontend tools, render tools, agent
// context) that aren't relevant to the prebuilt-chat docs page. This file
// gives the docs a minimal Chat definition to point at via the
// chat-component / configure-suggestions / provider-setup regions without
// disturbing the runtime demo.
//
// Why a sibling file: the bundler walks every file in the demo folder and
// extracts region markers from each, so a docs-targeted teaching example
// can live alongside the production demo without being wired into the
// route. See: showcase/scripts/bundle-demo-content.ts.

import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

// @region[chat-component]
function Chat() {
  // @region[configure-suggestions]
  useConfigureSuggestions({
    suggestions: [
      { title: "Write a sonnet", message: "Write a short sonnet about AI." },
    ],
    available: "always",
  });
  // @endregion[configure-suggestions]

  return <CopilotChat agentId="agentic_chat" className="h-full rounded-2xl" />;
}
// @endregion[chat-component]

export function AgenticChatPage() {
  return (
    // @region[provider-setup]
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agentic_chat">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
    // @endregion[provider-setup]
  );
}
