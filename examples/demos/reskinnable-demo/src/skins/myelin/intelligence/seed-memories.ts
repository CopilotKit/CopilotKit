/**
 * What Myelin "already knows" about Priya when the demo starts — beats 4 and 5
 * are a seeded file, not emergent behaviour.
 *
 * Deliberately NOT seeded: how to clear a publish blocked by the audience check.
 * That is beat 6 — the procedure the agent has to learn on stage by watching.
 */

const DEFAULT_TIMEOUT_MS = 10_000;

export interface SeedMemoriesParams {
  apiUrl: string;
  apiKey: string;
  userId: string;
  timeoutMs?: number;
}

interface SeedMemory {
  kind: "topical" | "episodic" | "operational";
  scope: "user" | "project";
  content: string;
}

export const SEED_MEMORIES: readonly SeedMemory[] = [
  {
    kind: "topical",
    scope: "user",
    content:
      "Priya Raman's conventions for every Harvest Lane frontline journey: (1) it OPENS with a short 'Why this " +
      "matters' video from the store manager, (2) every micro-lesson is 5 minutes or less — split anything longer, " +
      "(3) anything safety-critical (food safety, equipment) is gated by a quiz before the hands-on step it " +
      "protects, and (4) it ENDS with an on-shift observation signed off by a team lead. Apply these whenever " +
      "building or restructuring a journey, without being asked, and say which ones you applied.",
  },
  {
    kind: "operational",
    scope: "user",
    content:
      "Priya's launch procedure for a journey that has just been published (this is NOT about clearing a publish " +
      "that was blocked — that is a different situation; do not offer to record anything here): (1) call " +
      "set_enrollment_window with 14 days, (2) call notify_store_managers with a short, friendly note telling " +
      "store managers the journey is live, who it is for, and that learners have 14 days, (3) call " +
      "schedule_reminder with after_days 3 and a gentle nudge for learners who have not started. Run all three " +
      "immediately, in order, without asking, then confirm what was done in one short sentence.",
  },
];

export async function seedMemories(
  params: SeedMemoriesParams,
): Promise<number> {
  const { apiUrl, apiKey, userId, timeoutMs = DEFAULT_TIMEOUT_MS } = params;
  const base = apiUrl.replace(/\/$/, "");
  let stored = 0;
  for (const memory of SEED_MEMORIES) {
    try {
      const res = await fetch(`${base}/api/memories`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Cpki-User-Id": userId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(memory),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) stored += 1;
      else
        console.error(`[myelin/seed-memories] ${userId}: HTTP ${res.status}`);
    } catch (err) {
      console.error(`[myelin/seed-memories] ${userId}: ${String(err)}`);
    }
  }
  return stored;
}
