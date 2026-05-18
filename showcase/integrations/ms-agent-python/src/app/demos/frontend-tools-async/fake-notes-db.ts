// Demo-only fixture for frontend-tools-async. In a real app this would be
// IndexedDB, a fetched cache, or any other client-owned data store.
// Kept inline (and deterministic) so the async-handler round-trip is
// reproducible for tests and screenshots.

import type { Note } from "./notes-card";

export const NOTES_DB: Note[] = [
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
