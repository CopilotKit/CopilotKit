import type { Suggestion } from "@/shell/skin-contract";

/**
 * THE PILLS ARE THE DEMO SCRIPT.
 *
 * The presenter should never have to type. That is partly stagecraft and partly
 * correctness: free-typed phrasing routes to the wrong tool. Asking for the
 * comp "report" instead of the comp "bands" sends Rowan to the canvas brief
 * rather than the in-chat ladder, and the audience sees a hesitation that was
 * never about the product.
 *
 * ── BEAT MAP ────────────────────────────────────────────────────────────────
 * | Beat              | Rowan's step                          | Pill | Implemented by                                              |
 * | ----------------- | ------------------------------------- | ---- | ----------------------------------------------------------- |
 * | 1 face            | The compensation band ladder          | 1    | `showCompBands` useComponent → `components/band-ladder.tsx`  |
 * | 2 rich thread     | Reload; ladder + receipts still there | —    | every render keyed off `result`; `answeredSalaryChanges` map |
 * | 3a drive the app  | Merit increase, figure typed in chat  | 2    | `setBaseSalary` HITL → PATCH …/compensation                  |
 * | 3b sees my screen | Ask on Roster, then on Requests       | 3    | route readable (layout) + per-page readables (all 4 pages)   |
 * | 3c levers         | Oldest pending requests, top 10       | 4    | `showRequestQueue` HITL → ?status&sort&top, controls tinted  |
 * | 3d multimodal     | Offer letter → durable packet         | 5    | `onSuggestionSelect` + `attach-offer-letter` → POST /packets |
 * | 4 memory          | Comp summary in Maya's saved format   | 6    | seeded topical memory + `showCompSummary({ note })`          |
 * | 5 stored skill    | "Dana starts Monday — handle it"      | 7    | seeded operational memory → 3 writes amid 4 distractors      |
 * | 6 teach a skill   | Out-of-band raise approval            | 8    | 422 OUT_OF_BAND → offer → watch → save → replay on Naomi     |
 * | (canvas)          | The People Review brief               | 9    | server `render_people_brief` → a2ui `PeopleCanvasSurface`    |
 *
 * Beat 2 has no pill on purpose — it is demonstrated by reloading the browser
 * and reopening the thread, not by asking for anything.
 */

/**
 * Shared with `onSuggestionSelect` in skin.tsx by string equality, so the match
 * can never drift out of sync with the pill. This is the pill that must carry a
 * file, and the framework's suggestion path drops attachments — see
 * `attach-offer-letter.ts`.
 */
export const PACKET_MESSAGE =
  "Here's Dana Whitfield's signed offer letter. Read it and file her onboarding packet.";

export const peopleSuggestions: Suggestion[] = [
  // 1 — lead with generative UI. The ladder is the signature visual, and it is
  // also the setup for beats 4 and 6.
  {
    title: "Show me the comp bands",
    message:
      "Show me the compensation band ladder and tell me who's sitting outside their band.",
  },
  // 3a — a mutation whose sensitive value never reaches the assistant.
  {
    title: "Priya's merit increase",
    message: "Priya Raman is overdue for a review. Record her merit increase.",
  },
  // 3b — click this on TWO different pages. The answers must differ.
  {
    title: "What's on my screen?",
    message:
      "Look at the page I'm on right now and tell me what's on screen — the key elements and the figures shown.",
  },
  // 3c — HITL confirm, then navigate + filter + sort, controls visibly tinted.
  {
    title: "Oldest pending requests",
    message: "Show me the ten oldest requests still waiting on me.",
  },
  // 3d — intercepted in skin.tsx; stages the generated offer letter.
  { title: "File Dana's packet", message: PACKET_MESSAGE },
  // 4 — recalls the seeded preference AND names it in the note slot.
  {
    title: "Where does comp stand?",
    message: "Give me a summary of where compensation stands right now.",
  },
  // 5 — one vague sentence replays a seeded three-step procedure.
  {
    title: "Dana starts Monday",
    message: "Dana Whitfield starts Monday — handle it.",
  },
  // 6 — the gated action Rowan does NOT know how to do yet. It must decline.
  {
    title: "Approve Marcus's raise",
    message:
      "Clara put Marcus Bell up for Staff. Approve the compensation request.",
  },
  // The canvas artifact — a good closer, and the only pill that leaves chat.
  {
    title: "Prep the people review",
    message:
      "Put together the people review brief for the leadership meeting on the canvas.",
  },
];
