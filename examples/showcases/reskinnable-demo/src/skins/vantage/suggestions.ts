import type { Suggestion } from "@/shell/skin-contract";
import { REBUILD_DECK_MESSAGE } from "./attach-deck";

/**
 * ONE PILL PER BEAT, IN DEMO ORDER. The presenter never types — partly for
 * smoothness, but mainly for correctness: free-typed phrasing routes to the
 * wrong tool ("show me the report" vs "the trend" is a real collision in
 * banking), and pills remove that whole class of stage accident.
 *
 * Beat 2 has no pill — it is "reload the browser after pill 1".
 *
 * | Beat | Step | Pill | Implemented by |
 * | 1 face            | KPI tiles + trend + a two-sentence read | 1 | showKpiRow, showTrend |
 * | 2 rich thread     | reload after pill 1; charts replay      | — | arg-only gen-UI cards |
 * | 3a drive the app  | connect the warehouse, token stays in UI | 2 | connectSource |
 * | 3b sees my screen | ask on Boardroom, then on Explore       | 3 | route + per-page readables |
 * | 3c levers         | confirm 6 levers, navigate, highlight   | 4 | exploreMetric |
 * | 3d multimodal     | deck PDF -> durable board with a URL    | 5 | onSuggestionSelect + buildBoard |
 * | 4 memory          | DEFERRED to phase 2                    | — | — |
 * | 5 stored skill    | DEFERRED to phase 2                    | — | — |
 * | 6 teach a skill   | DEFERRED to phase 2                    | — | — |
 * | (extra) OGUI      | a shape no tile covers, labelled as such | 6 | generateSandboxedUi |
 */
export const vantageSuggestions: Suggestion[] = [
  {
    title: "How did we close the quarter?",
    message: "How did we close the quarter?",
  },
  {
    title: "Connect our warehouse",
    message: "Connect our finance warehouse to Vantage.",
  },
  {
    title: "What am I looking at?",
    message: "What am I looking at on this screen right now?",
  },
  {
    title: "Why did EMEA slip?",
    message:
      "Why did EMEA slip against plan last quarter? Take me to the numbers.",
  },
  {
    title: "Rebuild last quarter's deck",
    message: REBUILD_DECK_MESSAGE,
  },
  {
    title: "Revenue attribution as a Sankey",
    message:
      "Show me revenue attribution from channel through segment to region as a " +
      "Sankey diagram.",
  },
];
