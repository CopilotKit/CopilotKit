const REPO = "CopilotKit/CopilotKit";
const FALLBACK_STARS = 22000;

let cached: number | null = null;

/**
 * Build-time fetch of the public GitHub star count for the CopilotKit repo.
 * Cached per build process so multiple components rendering the header don't
 * each hit the API. Falls back to a hardcoded floor when the API is
 * unreachable or rate-limited (the unauthenticated limit is 60 req/hour).
 */
export async function getGitHubStars(): Promise<number> {
  if (cached !== null) return cached;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { "User-Agent": "copilotkit-docs-build" },
    });
    if (!res.ok) {
      cached = FALLBACK_STARS;
      return cached;
    }
    const data = (await res.json()) as { stargazers_count?: number };
    cached =
      typeof data.stargazers_count === "number"
        ? data.stargazers_count
        : FALLBACK_STARS;
    return cached;
  } catch {
    cached = FALLBACK_STARS;
    return cached;
  }
}

/**
 * Format star count for compact display: 22134 → "22.1k", 1234 → "1.2k",
 * 950 → "950". Mirrors GitHub's badge format.
 */
export function formatStars(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands.toFixed(1).replace(/\.0$/, "")}k`;
}
