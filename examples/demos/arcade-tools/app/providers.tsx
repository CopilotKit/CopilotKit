"use client";

import { CopilotKit } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import type { ReactNode } from "react";

/**
 * The v2 provider must be mounted from a Client Component. It opens the AG-UI
 * event stream to our runtime route and gives every CopilotKit hook/component
 * below it access to the agent.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      // Single-route transport: the client POSTs every call as a { method, params,
      // body } envelope to runtimeUrl. Must match the runtime route's
      // mode: "single-route" handler (see app/api/copilotkit/route.ts).
      useSingleEndpoint
      onError={(event) => {
        // Surfacing errors keeps the chat from getting stuck on "connecting…".
        console.error("[copilotkit]", event);
      }}
    >
      {children}
    </CopilotKit>
  );
}
