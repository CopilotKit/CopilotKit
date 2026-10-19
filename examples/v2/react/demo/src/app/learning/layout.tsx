"use client";

import { httpSink } from "@copilotkit/learning";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import Link from "next/link";
import { useState } from "react";

// One sink for the whole demo: every batch goes to the local SQLite route.
const sink = httpSink("/api/learning-events");

export default function LearningLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The app owns the Trajectory boundary: one Trajectory per visit to /learning.
  const [trajectoryId] = useState(() => crypto.randomUUID());

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-learning"
      useSingleEndpoint
      learning={{
        sink,
        routes: ["/learning/deals/:id"],
        capture: { agentText: true },
        trajectoryId,
      }}
    >
      <div className="min-h-screen bg-white text-gray-900">
        <header className="flex items-center gap-6 border-b px-6 py-3">
          <strong>Deals (learning demo)</strong>
          <Link href="/learning" data-copilotkit-action="nav.deals">
            Deals
          </Link>
          <Link href="/learning/events" data-copilotkit-action="nav.events">
            Captured events
          </Link>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </CopilotKitProvider>
  );
}
