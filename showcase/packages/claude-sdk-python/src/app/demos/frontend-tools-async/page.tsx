"use client";

import React from "react";
import {
  useFrontendTool,
  useConfigureSuggestions,
  CopilotChat,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";
import { z } from "zod";
import { NotesCard, type Note } from "./notes-card";

// Fake client-side "notes database" — populated inline for demo. The async
// handler awaits a 500ms simulated DB round-trip so the async frontend-tool
// path is exercised faithfully.
const NOTES_DB: Note[] = [
  {
    id: "n1",
    title: "Q2 project planning kickoff",
    excerpt:
      "Discussed scope for the new onboarding flow with design. Draft spec due Friday.",
    tags: ["planning", "project", "onboarding"],
  },
  {
    id: "n2",
    title: "Planning: migrate auth to passkeys",
    excerpt:
      "Research WebAuthn library options. Consider fallback for unsupported browsers.",
    tags: ["planning", "auth", "security"],
  },
  {
    id: "n3",
    title: "Grocery list",
    excerpt: "Olive oil, tomatoes, sourdough, basil, parmesan.",
    tags: ["personal", "shopping"],
  },
  {
    id: "n4",
    title: "Book recommendations",
    excerpt:
      "Thinking Fast and Slow (Kahneman); The Design of Everyday Things (Norman).",
    tags: ["reading"],
  },
  {
    id: "n5",
    title: "Project planning retrospective notes",
    excerpt:
      "What went well: async standups. What didn't: ambiguous ownership on shared components.",
    tags: ["retro", "project", "planning"],
  },
  {
    id: "n6",
    title: "Weekend hike plan",
    excerpt: "Tam West Peak → Rock Spring. 8mi loop, bring layers.",
    tags: ["personal", "outdoors"],
  },
  {
    id: "n7",
    title: "1:1 prep — career planning",
    excerpt: "Discuss growth areas. Ask about scope for Q3. Revisit goals doc.",
    tags: ["career", "planning"],
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonResult<T>(result: unknown): T {
  if (!result) return {} as T;
  try {
    return (typeof result === "string" ? JSON.parse(result) : result) as T;
  } catch {
    return {} as T;
  }
}

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
