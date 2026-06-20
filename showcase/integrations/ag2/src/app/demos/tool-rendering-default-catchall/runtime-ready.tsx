"use client";

import React from "react";
import {
  CopilotKitCoreRuntimeConnectionStatus,
  useCopilotKit,
} from "@copilotkit/react-core/v2";

export function RuntimeReady({ children }: { children: React.ReactNode }) {
  const { copilotkit } = useCopilotKit();

  if (
    copilotkit.runtimeUrl &&
    copilotkit.runtimeConnectionStatus !==
      CopilotKitCoreRuntimeConnectionStatus.Connected
  ) {
    return (
      <div
        data-testid="runtime-connecting"
        className="flex h-full w-full items-center justify-center text-sm text-muted-foreground"
      >
        Connecting...
      </div>
    );
  }

  return <>{children}</>;
}
