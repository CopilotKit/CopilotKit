"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { HashBrownDashboard } from "./hashbrown-renderer";
import { Chat } from "./chat";

export default function ByocHashbrownDemoPage() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-byoc-hashbrown"
      agent="byoc-hashbrown-demo"
    >
      <HashBrownDashboard>
        <div className="flex h-screen flex-col gap-3 p-6">
          <header>
            <h1 className="text-lg font-semibold">BYOC: Hashbrown</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Streaming structured output via <code>@hashbrownai/react</code>.
              The agent emits a catalog-constrained UI envelope that renders
              progressively as data streams.
            </p>
          </header>
          <div className="flex-1 overflow-hidden rounded-md border border-[var(--border)]">
            <Chat />
          </div>
        </div>
      </HashBrownDashboard>
    </CopilotKit>
  );
}
