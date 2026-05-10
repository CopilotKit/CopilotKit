"use client";

import React from "react";
import { CopilotPopup } from "@copilotkit/react-core/v2";

import { PreferencesCard, Preferences } from "./preferences-card";
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
    <div className="min-h-screen w-full bg-gray-50">
      <main className="mx-auto max-w-6xl p-6 md:p-10">
        <header className="mb-8 space-y-2">
          <h1 className="text-3xl font-semibold text-[#010507]">
            Shared state — read &amp; write
          </h1>
          <p className="text-sm text-[#57575B] max-w-2xl">
            The UI writes preferences into agent state and reads back the
            agent&apos;s scratch pad. Open the chat popup in the corner and ask
            the agent to remember something.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <PreferencesCard value={preferences} onChange={onPreferencesChange} />
          <NotesCard notes={notes} onClear={onClearNotes} />
        </div>
      </main>

      <CopilotPopup
        agentId="shared-state-read-write"
        defaultOpen={true}
        labels={{
          chatInputPlaceholder: "Chat with the agent...",
        }}
      />
    </div>
  );
}
