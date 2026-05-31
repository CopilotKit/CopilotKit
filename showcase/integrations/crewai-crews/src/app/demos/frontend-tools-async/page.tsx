"use client";

import React from "react";
import {
  CopilotChat,
  CopilotKit,
  useConfigureSuggestions,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { NotesCard, type Note } from "./notes-card";
import { NOTES_DB, sleep } from "./fake-notes-db";
import { parseJsonResult } from "../_shared/parse-json-result";

export default function FrontendToolsAsyncDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="frontend-tools-async">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

function Chat() {
  // @region[frontend-tool-async]
  // @region[frontend-tool-async-registration]
  useFrontendTool({
    name: "query_notes",
    description:
      "Search the user's local notes database for notes whose title, " +
      "excerpt, or tags contain the given keyword (case-insensitive). " +
      "Returns up to 5 matching notes.",
    parameters: z.object({
      keyword: z
        .string()
        .describe("Keyword or phrase to search notes for (case-insensitive)."),
    }),
    // @region[frontend-tool-async-handler]
    // Async handler: awaits a simulated client-side DB round-trip (500ms)
    // and returns the matching notes. The agent then uses the returned
    // result to summarize what it found — exercising the full async
    // frontend-tool path end-to-end.
    handler: async ({ keyword }: { keyword: string }) => {
      await sleep(500);
      const q = keyword.toLowerCase();
      const matches = NOTES_DB.filter((n) => {
        return (
          n.title.toLowerCase().includes(q) ||
          n.excerpt.toLowerCase().includes(q) ||
          (n.tags ?? []).some((t) => t.toLowerCase().includes(q))
        );
      }).slice(0, 5);
      return {
        keyword,
        count: matches.length,
        notes: matches,
      };
    },
    // @endregion[frontend-tool-async-handler]
    render: ({ args, result, status }) => {
      const loading = status !== "complete";
      const parsed = parseJsonResult<{
        keyword?: string;
        count?: number;
        notes?: Note[];
      }>(result);
      return (
        <NotesCard
          loading={loading}
          keyword={args?.keyword ?? parsed.keyword ?? ""}
          notes={parsed.notes}
        />
      );
    },
  });
  // @endregion[frontend-tool-async-registration]
  // @endregion[frontend-tool-async]

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Find project-planning notes",
        message: "Find my notes about project planning.",
      },
      {
        title: "Search for 'auth'",
        message: "Search my notes for anything related to auth.",
      },
      {
        title: "What do I have about reading?",
        message: "Do I have any notes tagged reading?",
      },
    ],
    available: "always",
  });

  return (
    <CopilotChat
      agentId="frontend-tools-async"
      className="h-full rounded-2xl"
    />
  );
}
