"use client";

import React from "react";
import { CopilotSidebar } from "@copilotkit/react-core/v2";

import type { Preferences } from "./preferences-card";
import { PreferencesCard } from "./preferences-card";
import { NotesCard } from "./notes-card";

interface DemoLayoutProps {
  preferences: Preferences;
  notes: string[];
  onPreferencesChange: (next: Preferences) => void;
  onClearNotes: () => void;
}

export function DemoLayout({
  preferences,
  notes,
  onPreferencesChange,
  onClearNotes,
}: DemoLayoutProps) {
  return (
    <div className="min-h-screen w-full overflow-y-auto bg-gray-50">
      <main className="mx-auto max-w-6xl p-6 md:p-10">
        <header className="mb-8 space-y-2">
          <h1 className="text-3xl font-semibold text-[#010507]">
            Shared state — read &amp; write
          </h1>
          <p className="text-sm text-[#57575B] max-w-2xl">
            The UI writes preferences into agent state and reads back the
            agent&apos;s scratch pad. Open the chat sidebar and ask the agent to
            remember something.
          </p>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
          <div className="min-w-0">
            <PreferencesCard
              value={preferences}
              onChange={onPreferencesChange}
            />
          </div>
          <div className="min-w-0">
            <NotesCard notes={notes} onClear={onClearNotes} />
          </div>
        </div>
      </main>

      <CopilotSidebar
        agentId="shared-state-read-write"
        defaultOpen={true}
        labels={{
          chatInputPlaceholder: "Chat with the agent...",
        }}
      />
    </div>
  );
}
