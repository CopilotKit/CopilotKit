"use client";

import type { ReactNode } from "react";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { TooltipProvider } from "@/components/ui/tooltip";

function Providers({ children }: { children: ReactNode }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" enableInspector={false}>
      <TooltipProvider>{children}</TooltipProvider>
    </CopilotKit>
  );
}

export { Providers };
