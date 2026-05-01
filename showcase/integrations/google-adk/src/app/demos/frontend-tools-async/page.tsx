"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useFrontendTool,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

import { NotesCard, queryLocalNotes } from "./notes-card";

export default function FrontendToolsAsyncDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="frontend_tools_async">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  useFrontendTool({
    name: "find_notes",
    description:
      "Search the user's local notes database. Pass a single query string. Returns the list of matching notes (id, title, body).",
    parameters: z.object({
      query: z.string().describe("Free-text search query."),
    }),
    handler: async ({ query }: { query: string }) => {
      const matches = await queryLocalNotes(query);
      return { count: matches.length, notes: matches };
    },
  });

  // Canonical e2e suggestion — exact catalog match for frontend-tools-async.
  // See showcase/aimock/_canonical-catalog.json (frozen).
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Async metric",
        message: "fetch the async metric",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex h-screen w-full bg-gray-50">
      <aside className="md:w-[320px] md:shrink-0 p-4 overflow-y-auto">
        <NotesCard />
      </aside>
      <main className="flex-1 flex flex-col min-h-0">
        <CopilotChat
          agentId="frontend_tools_async"
          className="flex-1 min-h-0"
          labels={{
            chatInputPlaceholder: "Ask the agent to search your notes...",
          }}
        />
      </main>
    </div>
  );
}
