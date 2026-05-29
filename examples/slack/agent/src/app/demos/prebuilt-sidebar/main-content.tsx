"use client";

import React from "react";
import { PanelRightOpen } from "lucide-react";

export function MainContent() {
  return (
    <main className="h-screen w-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <PanelRightOpen className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight text-foreground">
          Sidebar demo
        </h1>
        <p className="max-w-lg text-base leading-relaxed text-muted-foreground">
          The pre-built{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
            &lt;CopilotSidebar /&gt;
          </code>{" "}
          docks to the edge of the viewport and pushes this page&apos;s content
          instead of overlapping it. Toggle it with the launcher to see the
          layout shift.
        </p>
      </div>
    </main>
  );
}
