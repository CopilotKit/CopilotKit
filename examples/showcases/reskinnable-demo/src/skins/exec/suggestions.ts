import type { Suggestion } from "@/shell/skin-contract";

/**
 * The exec (Vantage) demo suggestion pills (registered by the shell,
 * available:"always"). One pill per beat, in demo order — beat 2 (thread
 * replay across reload) is a presenter action, not a pill.
 *
 * Beat map, copied verbatim from
 * `docs/superpowers/specs/2026-09-03-exec-dashboard-skin-design.md` §
 * "Demo beats (the map — authored before code, per demo-beats.md)":
 *
 * | Beat              | This skin's step                                                                                             | Pill                                        | Implemented by |
 * | ----------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | -------------- |
 * | 1 face            | First pill renders a revenue-vs-plan a2ui block inline + one-sentence answer                                  | "Show revenue vs. plan this quarter"        | `render_metric_block` + catalog |
 * | 2 rich thread     | Blocks replay from thread history across thread switch + hard reload (replay-safe tools)                      | —                                           | a2ui surfaces derived from thread messages — **verify early, see Risks** |
 * | 3a drive the app  | Agent files a variance narrative / adds a block to a dashboard; publish countersign PIN withheld (HITL card)  | "File a narrative for the Q3 margin miss"   | backend tools + HITL |
 * | 3b sees my screen | Route readable in `layout.tsx` + per-page on-screen readables                                                 | "What am I looking at?"                     | `useAgentContext` |
 * | 3c levers         | Metrics explorer driven by four query-string levers                                                           | "Show top 5 worst variances in Distribution"| explorer page |
 * | 3d multimodal     | Staged department budget memo PDF → ingested as a filed narrative (durable artifact)                          | paperclip + "File the attached memo"        | `chatHeaderActions` + `onSuggestionSelect` |
 * | 4 memory          | Seeded pref — "QoQ over YoY, EBITDA in the headline" — applied unprompted and NAMED when composing blocks     | "Build me a growth block"                   | `seed-memories.ts` |
 * | 5 stored skill    | Seeded month-end board-pack assembly procedure, replayed unaided                                              | "Run the month-end board pack"              | `seed-memories.ts` (scope `user`) |
 * | 6 teach a skill   | Publish fails 422 `UNEXPLAINED_VARIANCE` → teach: file narrative under justifying code, then publish          | "Publish the board pack"                    | gate + `offerWorkflowRecording` |
 *
 * The titles actually shipped below track the plan
 * (`docs/superpowers/plans/2026-09-03-exec-dashboard-skin.md`), which
 * refined a few of the design doc's working titles (e.g. the 3a scenario
 * moved from a margin miss to an opex overrun) after the table above was
 * written — the table stays verbatim as the historical beat map; the pills
 * below are the demo script actually wired.
 */

/**
 * Beat 3d's pill message, shared with `./attach-memo.ts` (which stages the
 * generated memo PDF) and `./skin.tsx` (whose `onSuggestionSelect` matches it
 * by string equality to intercept the send). Defined here, next to the pill
 * that carries it, so there is exactly ONE copy of the string and the three
 * call sites cannot drift apart — the same discipline banking uses for
 * `Q2_REPORT_MESSAGE`.
 */
export const MEMO_NARRATIVE_MESSAGE =
  "Here's the department budget memo I was handed — read it and file the " +
  "variance narrative it describes.";

export const execSuggestions: Suggestion[] = [
  // 1 — lead with generative UI: the revenue-vs-plan block, inline in chat.
  {
    title: "Show revenue vs. plan this quarter",
    message: "Show me revenue vs. plan for this quarter.",
  },
  // 3a — a mutation whose confirmation never reaches the assistant (HITL PIN).
  {
    title: "File a narrative for the Q3 opex overrun",
    message:
      "File a variance narrative for the Q3 opex overrun — explain what " +
      "happened and why, then save it against that metric and period.",
  },
  // 3b — ask it on one page, navigate, ask it again.
  {
    title: "What am I looking at?",
    message:
      "Look at the page I'm on right now and tell me what's on screen — the key elements and the figures shown.",
  },
  // 3c — navigate + filter + sort the metrics explorer via its four levers.
  {
    title: "Top 5 worst variances in Distribution",
    message:
      "Take me to the metrics explorer, filter to the Distribution " +
      "department, and show me the 5 metrics with the worst variance this quarter.",
  },
  // 3d — intercepted in skin.tsx; stages the generated memo PDF.
  {
    title: "File the attached memo as a narrative",
    message: MEMO_NARRATIVE_MESSAGE,
  },
  // 4 — recalls a seeded preference (QoQ over YoY, EBITDA headline) AND names it.
  {
    title: "Build me a growth block",
    message: "Build me a block showing our growth this quarter.",
  },
  // 5 — one vague sentence replays a seeded month-end assembly procedure.
  {
    title: "Assemble the month-end board pack",
    message: "Assemble this month's board pack.",
  },
  // 6 — the gated action it does NOT know how to do yet (publish gate + teach).
  {
    title: "Publish the CFO board pack",
    message: "Publish the CFO board pack.",
  },
];
