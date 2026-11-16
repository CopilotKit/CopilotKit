import { AppShell } from "@/components/shell/app-shell";
import { headers } from "next/headers";
import { serverEnv } from "@/lib/env";
import { EXAMPLE_REPOS, describeRedSince } from "@/lib/example-repos";
import type { RepoCardData } from "@/lib/example-repos";
import { repoFacts } from "@/lib/github";
import { userFromCookieHeader } from "@/lib/user";

// Reads the environment, cookies and live repo facts per request.
export const dynamic = "force-dynamic";

async function repoCards(): Promise<RepoCardData[]> {
  const now = Date.now();
  return Promise.all(
    EXAMPLE_REPOS.map(async (repo) => {
      const facts = await repoFacts(repo.slug);
      const ci = facts?.ci;
      return {
        ...repo,
        facts,
        redFor:
          ci?.state === "failing"
            ? describeRedSince(ci.since, ci.atLeast, now)
            : null,
      };
    }),
  );
}

export default async function Page() {
  const env = serverEnv();
  const repos = await repoCards();
  return (
    <AppShell
      repos={repos}
      threadsEnabled={Boolean(env.CPK_INTELLIGENCE_API_KEY)}
      initialUser={userFromCookieHeader((await headers()).get("cookie"))}
    />
  );
}
