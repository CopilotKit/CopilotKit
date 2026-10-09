import { test, expect } from "@playwright/test";
import { openChat, sendMessage, newThread } from "./helpers";

// Regression for the reported bug: "New conversation thread name is the same as
// the prior conversation name." The old ThreadTitler ran a useEffect keyed on
// activeThreadId and read the shared, agentId-scoped agent.messages — on a thread
// switch that still held the PREVIOUS thread's transcript, so a freshly created
// thread was named after the prior conversation. The fix drives titling off the
// agent's own events (ThreadTitler subscribes via agent.subscribe to
// onMessagesChanged/onRunStartedEvent), gated on agent.threadId === activeThreadId,
// so a thread is only ever named from its own transcript.
//
// Titling fires when the user's message is added / the run starts — it does NOT wait
// for the agent's reply, so this test is fast and unaffected by memory/LLM latency.
const ITEM = '[data-testid="thread-item"]';
const ACTIVE = '[data-testid="thread-item"][data-active="true"]';

test.describe("Thread titles", () => {
  test("a new thread is NOT named after the previous conversation", async ({
    page,
  }) => {
    await openChat(page);

    // Thread 1 is titled from its own first message.
    const msg1 = "Plan a trip to Tokyo next spring";
    await sendMessage(page, msg1);
    await expect(page.locator(ACTIVE)).toContainText(msg1, { timeout: 15_000 });

    // Start a new thread. The active thread MUST be the default title — not
    // thread 1's title (the bug). And thread 1's title must be untouched.
    await newThread(page);
    await expect(page.locator(ACTIVE)).toContainText("New conversation", {
      timeout: 15_000,
    });
    await expect(page.locator(ITEM).filter({ hasText: msg1 })).toHaveCount(1);

    // The new thread is titled from ITS OWN first message, leaving thread 1 intact.
    const msg2 = "Find hotels in Paris near the Louvre";
    await sendMessage(page, msg2);
    await expect(page.locator(ACTIVE)).toContainText(msg2, { timeout: 15_000 });
    await expect(page.locator(ITEM).filter({ hasText: msg1 })).toHaveCount(1);
    await expect(page.locator(ITEM)).toHaveCount(2);
  });
});
