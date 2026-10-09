import type { Suggestion } from "@/shell/skin-contract";

/**
 * ── BEAT MAP ────────────────────────────────────────────────────────────────
 * One pill per beat, in demo order. The ask: an admin agent for a learning
 * platform that builds and edits learning journeys, with governance, learning
 * and customer branding. (Fictional brands only: Myelin / Harvest Lane.)
 *
 * | Beat              | Step                                                      | Implemented by                                  |
 * | ----------------- | --------------------------------------------------------- | ----------------------------------------------- |
 * | 1 face            | Build the deli onboarding journey; it draws live          | ADK create_journey/add_item + openJourney + showJourney |
 * | 4 memory          | …and it applies Priya's saved conventions, and says so    | seed-memories (topical) + showJourney `note`    |
 * | 3a drive the app  | Edit it: prerequisite + a 7-day gap; graph re-flows       | ADK update_item                                  |
 * | 3b sees my screen | "What's on my screen?" on Journeys, then on Groups        | layout route readable + per-page readables      |
 * | 3c levers         | Who's behind on Front End training → confirm → filtered   | showLearners HITL + URL filters, highlighted    |
 * | governance        | Publish → impact card (412 learners, 38 overlaps, names   | check_audience + reviewPublish HITL             |
 * |                   | client-side only) → approve                               |                                                  |
 * | 6 teach a skill   | Publish refused (AUDIENCE_OVERLAP) → no saved procedure → | offerWorkflowRecording → awaitDemonstration →   |
 * |                   | watch the admin stagger → save; replays on Seafood        | saveLearnedProcedure + save_memory              |
 * | 5 stored skill    | "Launch it the usual way" → 3 visible writes              | seed-memories (operational) + 3 ADK tools       |
 * | collaboration     | Second window as Marcus (`?as=marcus`): presence + edits  | shared REST ledger + polling + presence         |
 * | branding          | Palette toggle → Harvest Lane brand across app AND chat   | theme.css `html[data-tenant]`                    |
 * | 2 rich thread     | Reload: the journey cards are still in the thread         | useComponent replay (Intelligence mode)         |
 * | 3d multimodal     | SKIPPED — not asked for; content ingest is a follow-up    |                                                  |
 */

export const BUILD_MESSAGE =
  "Build an onboarding journey for new deli associates across all three Deli groups.";

export const myelinSuggestions: Suggestion[] = [
  { title: "Build the deli onboarding journey", message: BUILD_MESSAGE },
  {
    title: "Add a prerequisite and a gap",
    message:
      "Slicer training should also require the allergens lesson, and put a 7-day practice gap before the on-shift observation.",
  },
  { title: "What's on my screen?", message: "What's on my screen right now?" },
  { title: "Publish it", message: "Publish the deli journey." },
  {
    title: "Launch it the usual way",
    message: "Launch the deli journey the usual way.",
  },
  {
    title: "Publish seafood onboarding",
    message: "Publish the Seafood Counter Onboarding journey.",
  },
  {
    title: "Who's behind on Front End?",
    message: "Who's most behind on Front End Cross-Training?",
  },
];
