"use client";

import type { ComponentType } from "react";
import { Paperclip } from "lucide-react";
import type { Skin, Suggestion } from "@/shell/skin-contract";
import { vantageIdentity } from "@/skins/vantage/identity";
import { vantageNav } from "@/skins/vantage/nav";
import { VantageLayout } from "@/skins/vantage/layout";
import { VantageTools } from "@/skins/vantage/tools";
import {
  VantageRuntimeProviders,
  useVantageRuntimeProperties,
} from "@/skins/vantage/providers";
import { catalog } from "@/skins/vantage/catalog";
import { VantageCanvasSurface } from "@/skins/vantage/canvas-surface";
import { vantageSuggestions } from "@/skins/vantage/suggestions";
import { VANTAGE_DESIGN_SKILL } from "@/skins/vantage/design-skill";
import { sandboxFunctions } from "@/skins/vantage/sandbox-functions";
// REBUILD_DECK_MESSAGE lives with the pill it belongs to, so the message the
// suggestion renders and the message `onSuggestionSelect` matches on are the
// same value — they cannot drift apart and silently degrade the deck-rebuild
// beat.
import {
  stageDeckAttachment,
  sendRebuildWithDeck,
  REBUILD_DECK_MESSAGE,
} from "@/skins/vantage/attach-deck";
import { BoardroomPage } from "@/skins/vantage/pages/boardroom";
import { ExplorePage } from "@/skins/vantage/pages/explore";
import { BoardsPage } from "@/skins/vantage/pages/boards";
import { MetricsPage } from "@/skins/vantage/pages/metrics";
import { BoardDetailPage } from "@/skins/vantage/pages/board-detail";

// Route segments after /vantage → page component. `resolvePage` is the SOLE
// segment validator (nav is display-only and deliberately omits boards/<id>).
const PAGES: Record<string, ComponentType> = {
  "": BoardroomPage,
  explore: ExplorePage,
  boards: BoardsPage,
  metrics: MetricsPage,
};

function resolvePage(segments: string[]): ComponentType | null {
  if (segments.length === 2 && segments[0] === "boards") {
    return BoardDetailPage;
  }
  const key = segments.length === 0 ? "" : segments.join("/");
  return PAGES[key] ?? null;
}

// Human-readable labels for the tool-activity chips (vantage-domain), so the
// chips read as phrases rather than raw tool names. Anything not listed falls
// back to a prettified raw name. recall_memory/save_memory are listed ahead of
// the phase-2 memory beats that will use them.
const TOOL_LABELS: Record<string, string> = {
  showKpiRow: "Pulling up the KPI tiles",
  showTrend: "Charting the trend",
  showBreakdown: "Breaking down the metric",
  showPlanVariance: "Comparing against plan",
  showDeals: "Pulling up deals",
  showBoard: "Opening the board",
  connectSource: "Connecting the warehouse",
  exploreMetric: "Exploring the metric",
  buildBoard: "Building the board",
  render_board: "Building the board on the canvas",
  generateSandboxedUi: "Generating an interactive UI",
  recall_memory: "Recalling from long-term memory",
  save_memory: "Saving to long-term memory",
};

/**
 * The "rebuild last quarter's deck" pill is the multimodal beat: it must ride
 * a real PDF attachment so the model reads the deck. The framework's
 * suggestion path drops attachments, so this pill instead drives the REAL
 * composer via `sendRebuildWithDeck` (staging the bundled deck, typing the
 * request, clicking send) — see attach-deck.ts. Matched by string equality
 * against the suggestion message, so it stays correct regardless of pill
 * order.
 */

// NOTE: no `agent` field — agents are server-only, registered in
// src/shell/agent-registry.ts keyed by this same id ("vantage"). This module
// must NEVER import agent.ts.
const vantage: Skin = {
  id: "vantage",
  identity: vantageIdentity,
  themeClass: "theme-vantage",
  Layout: VantageLayout,
  nav: vantageNav,
  resolvePage,
  // Registers the two global readables (metric catalog, connected sources) plus
  // nine tools: six gen-UI charts, the connectSource and exploreMetric HITL
  // flows, and buildBoard. Renders null.
  Tools: VantageTools,
  // Exec identity lives ABOVE CopilotKitProvider so it flows through the
  // provider's `properties` prop (ordering-independent), not a child racing
  // setProperties.
  RuntimeProviders: VantageRuntimeProviders,
  useRuntimeProperties: useVantageRuntimeProperties,
  // The a2ui board surface. Fed by the SERVER `render_board` tool in agent.ts —
  // a client tool result never produces the in-stream TOOL_CALL_RESULT the a2ui
  // middleware needs, so emitting these ops client-side would leave the canvas
  // permanently blank with no error.
  CanvasSurface: VantageCanvasSurface,
  catalog,
  suggestions: vantageSuggestions,
  designSkill: VANTAGE_DESIGN_SKILL,
  sandboxFunctions,
  toolLabels: TOOL_LABELS,
  // vantage has no single shared data hook: its components read the REST ledger
  // via the hooks in ./data directly, so nothing flows through useSkinData.
  // `useData` is therefore omitted (the contract makes it optional).
  // vantage ships no below-provider `Providers` stack: phase 1 has no
  // candidate for it (its only use would be a recording context, which is
  // phase 2). Omitted entirely rather than shipping a pass-through.
  // The paperclip in the chat header stages the bundled Q2 board deck.
  chatHeaderActions: [
    {
      icon: Paperclip,
      label: "Attach Q2 deck",
      onClick: () => void stageDeckAttachment(),
    },
  ],
  // Intercept the rebuild-deck pill to ride the deck attachment; every other
  // pill takes the shell's default "send the message" path.
  onSuggestionSelect: (suggestion: Suggestion) => {
    if (suggestion.message === REBUILD_DECK_MESSAGE) {
      void sendRebuildWithDeck();
      return true;
    }
    return false;
  },
};

export default vantage;
