import type { Suggestion } from "@/shell/skin-contract";
import { BULLETIN_MESSAGE } from "@/skins/keel/attach-bulletin";

/**
 * Keel's suggestion pills, registered by the shell with `available:"always"` and
 * ordered to WALK THE DEMO. The presenter should never have to type
 * (`demo-beats.md` § Presentation requirements).
 *
 * ── THE BEAT MAP, AND WHAT EACH PILL WAS VERIFIED TO PRODUCE ────────────────
 *
 * | # | Pill                     | Beat | Verified to produce                                                            |
 * | - | ------------------------ | ---- | ------------------------------------------------------------------------------ |
 * | 1 | How healthy is the library? | 1    | `showRegisterHealth` → tiles + per-space bars, every figure re-derived live     |
 * | 2 | Contractor PHI access    | (identity) | `search_knowledge` → grounded answer → `showSources` citation chips      |
 * | 3 | Start an access request  | (identity) | `showPlaybook` → `startRun` HITL plan-preview card                      |
 * | 4 | Release the STD-045 revision | 3a | `countersignRelease` → e-signature card; PIN never enters the transcript     |
 * | 5 | What am I looking at?    | 3b   | route readable + the page's own readable, read back rather than hedged          |
 * | 6 | What's overdue for review? | 3c | `showRegister` confirm card → `?attention=review_overdue&sort=review_due_asc`  |
 * | 7 | Read this bulletin       | 3d   | intercepted by `onSuggestionSelect`; attachment → `fileImpactBrief` → canvas    |
 * | 8 | Summarize the library    | 4    | `recall_memory` → `showRegisterSummary(note)`, grouped by space, overdue first  |
 * | 9 | POL-121 is out of date   | 5    | `raiseReviewFlag` → `sendOwnerNotice` → `addDocumentNote`, no confirmation      |
 * | 10 | Release the POL-114 revision | 6 | refused `UNENDORSED_REVISION` → `offerWorkflowRecording` → teach chain        |
 * | 11 | What needs me?          | (identity) | `showApprovals` scoped to the current persona                           |
 * | 12 | Where are we stuck?     | (identity) | `render_ops_report` → a2ui report on the canvas                         |
 *
 * Beat 2 has no pill by design: it is demonstrated by RELOADING the page after any
 * of the above and watching the cards come back off the recorded results. Beat 6's
 * unaided REPLAY also has no pill — the presenter asks about POL-208 in their own
 * words, which is the point of the replay (a scripted sentence would let the room
 * suspect it was rehearsed).
 *
 * ── TWO THINGS THAT WILL BREAK SILENTLY IF EDITED ───────────────────────────
 *
 * 1. **Pill 7's message IS `BULLETIN_MESSAGE`, imported.** `skin.tsx`'s
 *    `onSuggestionSelect` keys on that EXACT string to intercept the click and
 *    drive the real composer with the file attached. A retyped sentence — even one
 *    character out — takes the DEFAULT send path, which DROPS attachments: the
 *    prompt goes out without the bulletin, the model invents its contents, and a
 *    durable brief is filed that reads perfectly and proves the opposite of the
 *    beat. Nothing fails. Never retype it.
 *
 * 2. **Keel's original four pills survive verbatim** (rows 2, 3, 11, 12). They are
 *    the skin's identity — a policy question, starting a run, the approval queue,
 *    the canvas report — and the spec §11 walk-through is scripted against their
 *    exact copy. They are REORDERED into the beat arc, not reworded.
 *
 * ── WHY TWELVE AND NOT THE BEAT MAP'S "EIGHT TO NINE" ───────────────────────
 *
 * `data/beat-map.md` set the target at eight-to-nine, and that figure is
 * arithmetically incompatible with its own two other instructions once the pills
 * are actually counted. It asks for one pill per beat (1, 3a, 3b, 3c, 3d, 4, 5, 6
 * — eight, beat 2 being demonstrated by a reload rather than a pill), it names
 * "Where are we stuck?" as the ninth-pill exception, AND it requires all four
 * existing pills to survive. Eight beat pills plus four survivors is twelve; nine
 * is only reachable by dropping an identity pill or leaving a beat without one.
 *
 * Both of those were checked against the tools before choosing twelve, and neither
 * is available: each of the four identity pills is the ONLY pill that reaches its
 * tool — grounded citation (`search_knowledge` + `showSources`), the run
 * plan-preview HITL (`showPlaybook` + `startRun`), the persona-scoped approval
 * queue (`showApprovals`), and the a2ui canvas report (`render_ops_report`). No
 * beat pill above reaches any of them. Commerce ships nine because it was authored
 * beat-first and has no identity pills beyond the canvas one; keel predates the
 * bar and has three more. So the count is twelve and the beat map's figure is the
 * stale number, not this list.
 *
 * The register page is called the **Register** in every pill, matching the nav
 * label. The route segment is still `knowledge`; the label is not.
 */
export const keelSuggestions: Suggestion[] = [
  // ── BEAT 1 — lead with generative UI ─────────────────────────────────────
  // Verified: `showRegisterHealth` renders the four KPI tiles and the per-space
  // bars from the live ledger. The agent passes no figures.
  {
    title: "How healthy is the library?",
    message: "How healthy is the policy library right now?",
  },

  // ── Keel's identity: a grounded, cited policy answer ─────────────────────
  // Verified: `search_knowledge` returns corpus passages, then `showSources`
  // renders clickable chips that open the real document at the cited section.
  {
    title: "Contractor PHI access",
    message:
      "What's our policy on giving a contractor access to patient records?",
  },

  // ── Keel's identity: turn the answer into a process ──────────────────────
  // Verified: `showPlaybook` first (prompt rule 3), then `startRun`'s HITL
  // plan-preview card, which creates the run only on confirm.
  {
    title: "Start an access request",
    message:
      "Start a PHI access request for Priya Raman, a Radiology contractor starting Monday.",
  },

  // ── BEAT 3a — drive the app, secret withheld ─────────────────────────────
  // Verified: `countersignRelease` opens the e-signature card for STD-045's OWN
  // pending revision (Rev B, fully endorsed). The six digits go straight from the
  // card to `/countersignatures`; the agent's result is one sentence.
  {
    title: "Release the STD-045 revision",
    message: "Release the STD-045 revision to the workforce.",
  },

  // ── BEAT 3b — it can read the screen ─────────────────────────────────────
  // Verified: answers from the layout's route readable plus the page's own
  // on-screen readable — the levers in force, matching vs visible counts, and the
  // first refs IN THE ORDER SHOWN. Ask it on the Register, then again inside an
  // open document.
  {
    title: "What am I looking at?",
    message: "What am I looking at on this screen?",
  },

  // ── BEAT 3c — four real levers ───────────────────────────────────────────
  // Verified: `showRegister` confirms the levers as chips, then navigates to
  // `knowledge?attention=review_overdue&sort=review_due_asc`, and the Attention
  // and Sort controls on the page tint. Three rows carry `review_overdue`, so the
  // board is never left empty.
  {
    title: "What's overdue for review?",
    message: "Show me what's overdue for review, most overdue first.",
  },

  // ── BEAT 3d — multimodal in, durable artifact out ────────────────────────
  // ⚠️ IMPORTED, NEVER RETYPED. See note 1 in this file's header.
  {
    title: "Read this bulletin",
    message: BULLETIN_MESSAGE,
  },

  // ── BEAT 4 — long-term memory recall, with a visible "why" ───────────────
  // Verified: `recall_memory` first (prompt rule 11), then
  // `showRegisterSummary` with the recalled preference in `note` — grouped by
  // space, overdue first, whole-percent coverage, owner beside every ref, and
  // "coverage not measurable" rather than 0%.
  {
    title: "Summarize the library",
    message: "Summarize the policy library for me.",
  },

  // ── BEAT 5 — replay a stored procedure ───────────────────────────────────
  // Deliberately VAGUE: "handle it" is the whole test. Verified: the seeded
  // operational memory fires `raiseReviewFlag` → `sendOwnerNotice` →
  // `addDocumentNote` on POL-121, in order, with no confirmation card, and the
  // register row paints the flag, the notice and the 🚨 note.
  {
    title: "POL-121 is out of date",
    message: "POL-121 is out of date — handle it.",
  },

  // ── BEAT 6 — teach it a procedure it does not have ───────────────────────
  // Verified: POL-114 Rev D is unendorsed, so the release is refused with
  // `UNENDORSED_REVISION`; the agent relays it, finds nothing in memory, and calls
  // `offerWorkflowRecording`. The REPLAY (POL-208 Rev C) is deliberately unscripted
  // — see this file's header.
  {
    title: "Release the POL-114 revision",
    message: "Release the POL-114 revision to the workforce.",
  },

  // ── Keel's identity: the approval queue ──────────────────────────────────
  // Verified: `showApprovals`, scoped to the current persona's role. Switching
  // persona in the header changes the answer, which is the point.
  {
    title: "What needs me?",
    message: "What's waiting on my approval?",
  },

  // ── Keel's identity: the canvas report ───────────────────────────────────
  // Verified: `render_ops_report` emits a2ui operations the shared canvas renders
  // full-region through `KeelCanvasSurface`, with a "← Back" affordance.
  {
    title: "Where are we stuck?",
    message: "Where are requests getting stuck? Build me a view on the canvas.",
  },
];
