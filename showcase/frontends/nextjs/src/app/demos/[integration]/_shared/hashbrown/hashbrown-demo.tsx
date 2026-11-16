"use client";

import { Chat } from "./chat";
import { HashBrownDashboard } from "./hashbrown-renderer";

/**
 * The hashbrown dashboard page body: a header and the chat, whose assistant
 * messages render as hashbrown UI. Render it inside the page's
 * `<CopilotKit>` provider, which picks the runtime and the agent.
 */
export function HashBrownDemo() {
  return (
    <HashBrownDashboard>
      <div className="flex h-screen flex-col gap-3 p-6">
        <header>
          <h1 className="text-lg font-semibold">Declarative UI: Hashbrown</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Streaming structured output via <code>@hashbrownai/react</code>. The
            agent emits a catalog-constrained UI envelope that renders
            progressively as data streams.
          </p>
        </header>
        <div className="flex-1 overflow-hidden rounded-md border border-[var(--border)]">
          <Chat />
        </div>
      </div>
    </HashBrownDashboard>
  );
}
