/**
 * Repositories offered on the empty state. Only the list lives here; stars,
 * language, avatar and CI status are read live from GitHub on the server
 * (src/lib/github.ts). Any public owner/name typed in the chat works the same.
 */
export interface ExampleRepo {
  slug: `${string}/${string}`;
  /** Short line shown on the card. */
  label: string;
  /** What is sent to the agent. */
  prompt: string;
}

export const EXAMPLE_REPOS: readonly ExampleRepo[] = [
  {
    slug: "google-gemini/genai-processors",
    label: "Why is CI failing?",
    prompt: "Why is CI failing on google-gemini/genai-processors?",
  },
  {
    slug: "CopilotKit/CopilotKit",
    label: "Check CI",
    prompt: "Check CI on CopilotKit/CopilotKit",
  },
];

/** What the server read from GitHub for one card. Absent fields were not available. */
export interface RepoFacts {
  stars: number;
  language: string | null;
  avatarUrl: string;
  defaultBranch: string;
  ci: CiFacts | null;
}

export type CiFacts =
  | { state: "passing"; workflows: number }
  | {
      state: "failing";
      /** The newest failing workflow, and how many workflows fail in all. */
      workflow: string;
      failingWorkflows: number;
      /** When the current run of failures began (ISO), as far back as the history goes. */
      since: string;
      /** The history ran out before a passing run: red for at least this long. */
      atLeast: boolean;
    };

/** A card as the page renders it: the config entry plus live facts, if any. */
export interface RepoCardData extends ExampleRepo {
  facts: RepoFacts | null;
  /** A plain phrase for how long CI has been red, computed at request time. */
  redFor: string | null;
}

export function formatStars(stars: number): string {
  return stars >= 1000
    ? `${(stars / 1000).toFixed(1).replace(/\.0$/, "")}k`
    : String(stars);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAY_MS = 86_400_000;

/** "for 3 days", "since Aug 2025", or "since Aug 2025 or earlier". */
export function describeRedSince(
  sinceIso: string,
  atLeast: boolean,
  now: number,
): string {
  const since = new Date(sinceIso);
  const days = Math.floor((now - since.getTime()) / DAY_MS);
  // The year only when it is not this one: "since Aug", "since Aug 2025".
  const sameYear = since.getUTCFullYear() === new Date(now).getUTCFullYear();
  const month = sameYear
    ? MONTHS[since.getUTCMonth()]!
    : `${MONTHS[since.getUTCMonth()]} ${since.getUTCFullYear()}`;
  if (atLeast) return `since ${month} or earlier`;
  if (days < 1) return "since today";
  if (days < 45) return `for ${days} day${days === 1 ? "" : "s"}`;
  return `since ${month}`;
}
