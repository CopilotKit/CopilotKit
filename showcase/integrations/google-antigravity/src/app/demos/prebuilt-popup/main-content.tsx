"use client";

import React from "react";
import { MessageCircle } from "lucide-react";

export function MainContent() {
  return (
    <main className="h-screen w-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <MessageCircle className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight text-foreground">
          Popup demo
        </h1>
        <p className="max-w-lg text-base leading-relaxed text-muted-foreground">
          The pre-built{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
            &lt;CopilotPopup /&gt;
          </code>{" "}
          floats above the page. A launcher bubble sits in the corner and opens
          an overlay chat — your existing layout keeps its shape underneath.
        </p>
      </div>
    </main>
  );
}
