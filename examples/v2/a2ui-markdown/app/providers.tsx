"use client";

import type { ReactNode } from "react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import type {
  GenerativeUI,
  GenerativeUITheme,
} from "@copilotkit/react-core/v2/generative-ui";

export type ExampleTransport = "markdown" | "tool";

export function Providers({
  children,
  transport,
  ui,
  theme,
}: {
  children: ReactNode;
  transport: ExampleTransport;
  /** The components the agent renders: standardUI, or the Kumo version. */
  ui: GenerativeUI;
  theme?: GenerativeUITheme;
}) {
  return (
    // useSingleEndpoint={false} selects the REST transport served by the
    // multi-route runtime in app/api/copilotkit/[[...slug]]/route.ts.
    //
    // Both transports use the same components. "markdown": the agent
    // writes the operations inside ```a2ui fences in its reply. "tool": the
    // runtime gives the agent the render_ui tool and streams the surfaces
    // as activity messages.
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      generativeUI={{ ui, transport, theme }}
    >
      {children}
    </CopilotKitProvider>
  );
}
