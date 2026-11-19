"use client";

import type { ComponentProps, ReactNode } from "react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";

export type DemoTransport = "markdown" | "tool";

export type DemoErrorHandler = NonNullable<
  ComponentProps<typeof CopilotKitProvider>["onError"]
>;

export function Providers({
  children,
  transport,
  onError,
}: {
  children: ReactNode;
  transport: DemoTransport;
  onError?: DemoErrorHandler;
}) {
  return (
    // useSingleEndpoint={false} selects the REST transport served by the
    // multi-route runtime in app/api/copilotkit/[[...slug]]/route.ts.
    //
    // Both transports use the standard components as they ship. "markdown":
    // the agent writes the operations inside ```a2ui fences in its reply.
    // "tool": the runtime gives the agent the render_ui tool and streams the
    // surfaces as activity messages.
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      generativeUI={{ ui: standardUI, transport }}
      onError={onError}
    >
      {children}
    </CopilotKitProvider>
  );
}
