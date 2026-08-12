"use client";

import type { ComponentType } from "react";
import { Paperclip } from "lucide-react";
import type { Skin, Suggestion } from "@/shell/skin-contract";
import { logisticsIdentity } from "./identity";
import { logisticsNav } from "./nav";
import { LogisticsLayout } from "./layout";
import { LogisticsTools } from "./tools";
import {
  LogisticsProviders,
  LogisticsRuntimeProviders,
  useLogisticsRuntimeProperties,
} from "./providers";
import { LogisticsCanvasSurface } from "./canvas-surface";
import { catalog } from "./catalog";
import { logisticsSuggestions } from "./suggestions";
import { MERIDIAN_DESIGN_SKILL } from "./design-skill";
import { sandboxFunctions } from "./sandbox-functions";
import { ControlTowerPage } from "./pages/control-tower";
import { LanesPage } from "./pages/lanes";
import { InventoryPage } from "./pages/inventory";
import { DecisionsPage } from "./pages/decisions";
import {
  attachRateSheetByHand,
  sendRateSheetMessage,
  RATE_SHEET_MESSAGE,
} from "./attach-rate-sheet";

// Route segments after /logistics → page component. Empty → the control tower.
const PAGES: Record<string, ComponentType> = {
  "": ControlTowerPage,
  lanes: LanesPage,
  inventory: InventoryPage,
  decisions: DecisionsPage,
};

// Human-readable activity-chip labels for this skin's own tools, in the
// present-participle voice both shipped skins use. Unlisted tools fall back to
// a prettified raw name.
const TOOL_LABELS: Record<string, string> = {
  showExceptions: "Scanning the exception queue",
  showExceptionSummary: "Summarizing the queue your way",
  showExceptionQueue: "Setting up the exception view",
  showShipment: "Pulling up the shipment",
  showLane: "Checking lane health",
  showInventoryRisk: "Checking inventory cover",
  compareMitigations: "Weighing the options",
  commitMitigation: "Committing the decision",
  authorizeWithPlannerPin: "Opening the authorization card",
  fileEscalation: "Filing an escalation",
  createDecisionRecord: "Filing to the decision log",
  fileRateBrief: "Filing the rate brief",
  // BEAT 5 — the stored procedure's three writes, then its distractors. The
  // distractors get labels too: an unlabelled chip falls back to a prettified
  // raw name, which is exactly the tell that would let the room spot which
  // tools were "the real ones" before the agent chose.
  raiseShipmentWatch: "Flagging it on the board",
  notifyCarrier: "Messaging the carrier",
  postShipmentNote: "Noting it on the shipment",
  requestProofOfDelivery: "Requesting proof of delivery",
  bookDrayageSlot: "Booking a drayage slot",
  requestLaneCapacityForecast: "Requesting a capacity forecast",
  openCargoClaim: "Opening a cargo claim",
  renderBrief: "Building the decision brief",
  generateSandboxedUi: "Generating an interactive view",
  recall_memory: "Recalling from long-term memory",
  save_memory: "Saving to long-term memory",
};

// NOTE: no `agent` field — agents are server-only, registered in
// src/shell/agent-registry.ts under this same id ("logistics"). This module
// must NEVER import agent.ts.
const logistics: Skin = {
  id: "logistics",
  identity: logisticsIdentity,
  themeClass: "theme-logistics",
  Layout: LogisticsLayout,
  nav: logisticsNav,
  resolvePage: (segments) =>
    PAGES[segments.length === 0 ? "" : segments.join("/")] ?? null,
  Tools: LogisticsTools,
  catalog,
  suggestions: logisticsSuggestions,
  designSkill: MERIDIAN_DESIGN_SKILL,

  // Planner auth lives ABOVE CopilotKitProvider so identity flows through the
  // provider's `properties` prop rather than a child racing setProperties.
  RuntimeProviders: LogisticsRuntimeProviders,
  useRuntimeProperties: useLogisticsRuntimeProperties,
  Providers: LogisticsProviders,
  CanvasSurface: LogisticsCanvasSurface,
  sandboxFunctions,
  toolLabels: TOOL_LABELS,

  // BEAT 3d — both of these exist to serve the attachment beat, and neither is
  // decorative: the framework's suggestion path DROPS attachments, so a pill
  // that must carry a file has to be intercepted here and driven through the
  // real composer instead.
  chatHeaderActions: [
    {
      icon: Paperclip,
      label: "Attach the carrier rate sheet",
      // The manual escape hatch: if the pill path misbehaves on stage the
      // presenter can still stage the file by hand and carry on typing. It is
      // the fallback, so it must be the LOUDEST link in the chain — if this one
      // failed quietly too, the presenter would have nothing left to try.
      onClick: () => void attachRateSheetByHand(),
    },
  ],

  onSuggestionSelect: (suggestion: Suggestion) => {
    if (suggestion.message !== RATE_SHEET_MESSAGE) {
      return false; // every other pill takes the default "send the message" path
    }
    // `true` means "the shell must not run its default send", and that is
    // unconditionally correct for this pill: the default path would send
    // "ingest this rate sheet" with the attachment DROPPED, which is the exact
    // failure beat 3d cannot survive — the model would invent the document's
    // contents and file a brief that proves nothing. So the click is claimed
    // either way, and `sendRateSheetMessage` guarantees the only two outcomes
    // are "sent with the sheet" or "aborted and the presenter was told why".
    void sendRateSheetMessage();
    return true;
  },

  // `useData` is omitted: like banking, components read the REST ledger through
  // useLogistics() and the planner through usePlannerAuth() directly, so
  // useSkinData<T>() correctly returns undefined.
};

export default logistics;
