import type { Suggestion } from "@/shell/skin-contract";

/**
 * THE PILLS ARE THE DEMO SCRIPT.
 *
 * The presenter should never have to type. That is half stagecraft and half
 * correctness: free-typed phrasing routes to the wrong tool. Asking for the
 * margin "report" instead of the margin "ladder" sends Bellwether to the canvas
 * trading brief rather than the in-chat ladder, and the audience reads the
 * hesitation as the product being unsure.
 *
 * ── BEAT MAP ────────────────────────────────────────────────────────────────
 * | Beat              | Bellwether's step                       | Pill | Implemented by                                                  |
 * | ----------------- | --------------------------------------- | ---- | --------------------------------------------------------------- |
 * | 1 face            | The margin ladder                       | 1    | `showMarginLadder` useComponent → `components/margin-ladder.tsx` |
 * | 2 rich thread     | Reload; ladder + receipts still there   | —    | every render keyed off `result`; `answeredRefunds` map           |
 * | 3a drive the app  | Goodwill refund, figure typed in chat   | 2    | `issueRefund` HITL → POST …/returns/[id]/refund                  |
 * | 3b sees my screen | Ask on Orders, then on Catalog          | 3    | route readable (layout) + per-page readables (all 4 pages)       |
 * | 3c levers         | Oldest orders on exception, top 10      | 4    | `showOrderQueue` HITL → ?status&exception&sort&top, tinted       |
 * | 3d multimodal     | Vendor price sheet → durable plan       | 5    | `onSuggestionSelect` + `attach-price-sheet` → POST /plans        |
 * | 4 memory          | Margin summary in Nadia's saved format  | 6    | seeded topical memory + `showMarginSummary({ note })`            |
 * | 5 stored skill    | "Order 4471 looks fraudulent — handle"  | 7    | seeded operational memory → 3 writes amid 4 distractors          |
 * | 6 teach a skill   | Below-floor markdown approval           | 8    | 422 BELOW_MARGIN_FLOOR → offer → watch → save → replay on Slate  |
 * | (canvas)          | The Trading Review brief                | 9    | server `render_trade_brief` → a2ui `CommerceCanvasSurface`       |
 *
 * Beat 2 has no pill on purpose — it is demonstrated by reloading the browser
 * and reopening the thread, not by asking for anything.
 *
 * Beat 6 is taught on the **Cedar Hoodie** markdown and replayed unaided on the
 * **Slate Chelsea Boot** markdown. Both are seeded below the margin floor, so
 * the case taught on stage is never the case the replay lands on.
 */

/**
 * Shared with `onSuggestionSelect` in skin.tsx by string equality, so the match
 * can never drift out of sync with the pill. This is the pill that must carry a
 * file, and the framework's suggestion path DROPS attachments — see
 * `attach-price-sheet.ts`.
 */
export const RESTOCK_PLAN_MESSAGE =
  "Here's the autumn price sheet from Kestrel Mills. Read it and file the restock plan.";

export const commerceSuggestions: Suggestion[] = [
  // 1 — lead with generative UI. The ladder is Bellwether's signature visual and
  // the setup for beats 4 and 6.
  {
    title: "Show me the margin ladder",
    message:
      "Show me the margin ladder and tell me which products are sitting below their margin floor.",
  },
  // 3a — a mutation whose sensitive value never reaches the assistant.
  {
    title: "Refund Marguerite's return",
    message:
      "Marguerite Bell's Aspen Shell return is approved. Issue the goodwill refund.",
  },
  // 3b — click this on TWO different pages. The answers must differ.
  {
    title: "What's on my screen?",
    message:
      "Look at the page I'm on right now and tell me what's on screen — the key elements and the figures shown.",
  },
  // 3c — HITL confirm, then navigate + filter + sort, controls visibly tinted.
  {
    title: "Oldest orders on exception",
    message: "Show me the ten oldest orders still stuck on an exception.",
  },
  // 3d — intercepted in skin.tsx; stages the generated vendor price sheet.
  { title: "File the restock plan", message: RESTOCK_PLAN_MESSAGE },
  // 4 — recalls the seeded preference AND names it in the note slot.
  {
    title: "Where does margin stand?",
    message: "Give me a summary of where margin stands right now.",
  },
  // 5 — one vague sentence replays a seeded three-step procedure.
  {
    title: "Order 4471 looks wrong",
    message: "Order 4471 looks fraudulent — handle it.",
  },
  // 6 — the gated action Bellwether does NOT know how to do yet. It must decline.
  {
    title: "Approve the Cedar markdown",
    message:
      "Sales put the Cedar Hoodie up for an autumn markdown. Approve the promotion.",
  },
  // The canvas artifact — a good closer, and the only pill that leaves chat.
  {
    title: "Prep the trading review",
    message:
      "Put together the trading review brief for Monday's leadership meeting on the canvas.",
  },
];
