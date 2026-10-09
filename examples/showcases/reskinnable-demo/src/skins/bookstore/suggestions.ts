import type { Suggestion } from "@/shell/skin-contract";

/**
 * ⚠️ RUNTIME REQUIREMENT — read before demoing this skin.
 *
 * Beats 2, 4 and 5 exist ONLY in Intelligence mode: all three of
 * INTELLIGENCE_API_URL, INTELLIGENCE_GATEWAY_WS_URL and CPK_INTELLIGENCE_API_KEY must
 * be set. On the default OSS path the runner is in-memory, so threads are
 * ephemeral and recall_memory does not exist — which removes THREE of this skin's
 * four headline claims and leaves a pretty storefront with a chatbot. Demo this
 * in Intelligence mode or do not demo this skin.
 *
 * ── THE BEAT MAP (mandatory — .claude/skills/reskin/demo-beats.md) ──────────
 *
 * | Beat              | This skin's step                                  | Pill                | Implemented by |
 * | ----------------- | ------------------------------------------------- | ------------------- | -------------- |
 * | 1 face            | book-cover cards answer the first question        | What's new          | showBooks (useComponent) |
 * | 2 rich thread     | presenter hard-reloads; every card is still there | (none — presenter)  | result-keyed useComponent renders; Intelligence only |
 * | 3a drive the app  | shopper types the card in chat; agent sees last4  | Check out           | openCheckout (HITL) + CheckoutCard |
 * | 3b sees my screen | asked on the filtered shelf, then on a book page  | What's on screen?   | route readable (layout.tsx) + page readables |
 * | 3c levers         | confirms the filters, navigates, controls light up| Cheapest sci-fi     | browseWithFilters (HITL) + browse query params |
 * | 3d multimodal     | SKIPPED — deferred to phase 2 (no attachment path, no artifact store) | — | — |
 * | 4 memory          | the pill recalls a taste nobody typed, NAMED in the answer | Something for me | recommendBooks note slot + intelligence/seed-memories.ts |
 * | 5 stored skill    | one vague sentence fires four writes in order     | Book club order     | seeded operational memory + swapEdition/applyPromoCode/setDeliveryBy + 3 distractors |
 * | 6 teach a skill   | SKIPPED — deferred to phase 2 (needs a gate + recording context) | — | — |
 *
 * Beats 3d and 6 are deliberate omissions at the user's direction, not
 * oversights — the rows are kept so a reader can tell the difference.
 *
 * ── PRESENTER NOTES ────────────────────────────────────────────────────────
 *  · Beat 2 has NO pill: it is the presenter hard-reloading the browser, best
 *    done after pill 3 so there is a shelf of cards to survive.
 *  · Pill 4 is worth asking TWICE — once on the filtered shelf, then click into a
 *    book and ask again. Two different correct answers is the beat.
 *  · Beat 4 is the RECALL, not a persona contrast. Click "Something for me" and
 *    the agent applies constraints nobody typed — paperback or ebook, under $20,
 *    literary/translated, translator named — and prints the recalled preference in
 *    `recommendBooks`' `note` slot instead of applying it silently. That is the
 *    beat, and it works: `dev/reset` seeds the preference into the DEFAULT memory
 *    bucket (the one a run usually resolves to) as well as Maya's mapped one.
 *  · ⚠ DO NOT present the shopper switcher as memory isolation. Switching forwards
 *    different `properties`, but those `properties` frequently do not reach
 *    `identifyUser` on a run, so BOTH shoppers resolve to the same default memory
 *    bucket and switching re-scopes NOTHING — shopping as Guest can recall Maya's
 *    preference. This is app-wide, not this skin's own defect; the authorities are
 *    the CAVEAT block in `.env.example` and the flagged comments in
 *    `src/shell/agent-registry.ts`. Demo beat 4 as one shopper.
 *  · Messages are fixed by the demo script. A reword routes differently — say
 *    "cheapest sci-fi paperbacks", not "cheap sci-fi books" — which is the
 *    correctness reason pills exist, not just a convenience.
 *  · The run ends with a filled, unpaid cart — that is the accepted cost of
 *    placing it last, so close the demo by clicking "Check out" once more,
 *    which is the adjacent pill.
 *  · Beat 5 is runtime-conditional exactly like beats 2 and 4: no
 *    Intelligence, no seeded procedure, no beat — and the agent improvises
 *    instead, which is worse on stage than an obvious failure because it
 *    looks like it *almost* knows.
 */
export const bookstoreSuggestions: Suggestion[] = [
  {
    title: "What's new",
    message: "What's new in translated fiction?",
  },
  {
    title: "Something for me",
    message: "Pick me something for the weekend.",
  },
  {
    title: "Cheapest sci-fi",
    message: "Show me the cheapest sci-fi paperbacks.",
  },
  {
    title: "What's on screen?",
    message: "What's on my screen right now?",
  },
  {
    title: "Add the top pick",
    message: "Add the top pick to my cart.",
  },
  {
    title: "Check out",
    message: "Check out.",
  },
  {
    title: "Book club order",
    message: "Set up my book club order.",
  },
];
