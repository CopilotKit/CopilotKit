"use client";

import type { ReactNode } from "react";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { TooltipProvider } from "@/components/ui/tooltip";

function Providers({ children }: { children: ReactNode }) {
  return (
    // useSingleEndpoint={false} selects the REST transport, which is what the
    // multi-route runtime in app/api/copilotkit/[[...slug]]/route.ts serves.
    // Omitting it makes this provider send a single-route envelope to the bare
    // basePath, which a multi-route runtime answers with 404.
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      enableInspector={false}
    >
      <TooltipProvider>{children}</TooltipProvider>
    </CopilotKit>
  );
}

export { Providers };
