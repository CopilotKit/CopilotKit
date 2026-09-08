import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import { FIRST_SIGNAL_TIMEOUT_MS } from "./_genuine-shared.js";

export const THREAD_ROUNDTRIP_PROMPT =
  "invoke testFrontendToolCalling with label X";

interface ThreadRoundtripSnapshot {
  cardText: string;
  pageText: string;
}

/** Validate both the browser-side tool result and the agent follow-up. */
export function validateThreadRoundtrip(
  snapshot: ThreadRoundtripSnapshot,
): string | undefined {
  if (!/label:\s*X/i.test(snapshot.cardText)) {
    return "thread tool card did not render label X";
  }
  if (!/handled\s+X/i.test(snapshot.cardText)) {
    return "thread tool card did not render the frontend handler result";
  }
  if (!/Frontend tool finished for X\./i.test(snapshot.pageText)) {
    return "agent follow-up did not confirm the frontend tool result";
  }
  return undefined;
}

async function readSnapshot(page: Page): Promise<ThreadRoundtripSnapshot> {
  return (await page.evaluate(() => {
    const browser = globalThis as unknown as {
      document: {
        body?: { innerText?: string };
        querySelector(selector: string): { textContent?: string | null } | null;
      };
    };
    const card = browser.document.querySelector(
      '[data-testid="ent-658-tool-card"]',
    );
    return {
      cardText: card?.textContent ?? "",
      pageText: browser.document.body?.innerText ?? "",
    };
  })) as ThreadRoundtripSnapshot;
}

/** Wait for the complete frontend-tool and follow-up round trip. */
export function buildThreadRoundtripAssertion(opts?: {
  timeoutMs?: number;
}): (page: Page) => Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? FIRST_SIGNAL_TIMEOUT_MS;
  return async (page: Page): Promise<void> => {
    await page.waitForSelector('[data-testid="ent-658-tool-card"]', {
      timeout: timeoutMs,
    });
    const deadline = Date.now() + timeoutMs;
    let problem = "thread round trip did not settle";
    while (Date.now() < deadline) {
      problem = validateThreadRoundtrip(await readSnapshot(page)) ?? "";
      if (!problem) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
    throw new Error(`threadid-frontend-tool-roundtrip: ${problem}`);
  };
}

/** Build the one-turn thread round-trip probe. */
export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: THREAD_ROUNDTRIP_PROMPT,
      assertions: buildThreadRoundtripAssertion(),
      responseTimeoutMs: 60_000,
    },
  ];
}

registerD5Script({
  featureTypes: ["threadid-frontend-tool-roundtrip"],
  fixtureFile: "threadid-frontend-tool-roundtrip.json",
  buildTurns,
});
