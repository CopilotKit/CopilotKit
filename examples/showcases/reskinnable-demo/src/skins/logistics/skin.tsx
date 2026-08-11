"use client";

import type { ComponentType } from "react";
import type { Skin } from "@/shell/skin-contract";
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
  showExceptionQueue: "Setting up the exception view",
  showShipment: "Pulling up the shipment",
  showLane: "Checking lane health",
  showInventoryRisk: "Checking inventory cover",
  compareMitigations: "Weighing the options",
  commitMitigation: "Committing the decision",
  authorizeWithPlannerPin: "Opening the authorization card",
  fileEscalation: "Filing an escalation",
  createDecisionRecord: "Filing to the decision log",
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

  // `useData` is omitted: like banking, components read the REST ledger through
  // useLogistics() and the planner through usePlannerAuth() directly, so
  // useSkinData<T>() correctly returns undefined.
  // `chatHeaderActions` and `onSuggestionSelect` are omitted deliberately —
  // both exist in banking only to serve its PDF-attachment beat.
};

export default logistics;
