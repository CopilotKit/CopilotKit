"use client";

import type { ComponentType } from "react";
import { GraduationCap, Route, ScrollText, Users } from "lucide-react";
import type { NavRoute, Skin } from "@/shell/skin-contract";
import { myelinIdentity } from "./identity";
import { MyelinLayout } from "./layout";
import { MyelinTools } from "./tools";
import { JourneysPage } from "./pages/journeys";
import { GroupsPage } from "./pages/groups";
import { LearnersPage } from "./pages/learners";
import { AuditPage } from "./pages/audit";
import { myelinCatalog } from "./catalog";
import { myelinSuggestions } from "./suggestions";
import { MYELIN_DESIGN_SKILL } from "./design-skill";
import {
  MyelinProviders,
  MyelinRuntimeProviders,
  useMyelinRuntimeProperties,
} from "./providers";

const nav: NavRoute[] = [
  { segment: "", label: "Journeys", icon: Route },
  { segment: "groups", label: "Groups", icon: Users },
  { segment: "learners", label: "Learners", icon: GraduationCap },
  { segment: "audit", label: "Audit log", icon: ScrollText },
];

/**
 * `resolvePage` is the single segment validator. A `Map`, not a plain object,
 * so `/myelin/toString` 404s instead of resolving through the prototype chain.
 * `journey/<id>` is the builder deep link the agent's `openJourney` uses.
 */
const PAGES: Map<string, ComponentType> = new Map([
  ["", JourneysPage],
  ["groups", GroupsPage],
  ["learners", LearnersPage],
  ["audit", AuditPage],
]);

function resolvePage(segments: string[]): ComponentType | null {
  if (
    segments.length === 2 &&
    segments[0] === "journey" &&
    /^[a-z0-9-]{1,60}$/.test(segments[1]!)
  ) {
    return JourneysPage;
  }
  const key = segments.length === 0 ? "" : segments.join("/");
  return PAGES.get(key) ?? null;
}

/** Human labels for tool-activity chips — including the ADK agent's server tools. */
const TOOL_LABELS: Record<string, string> = {
  get_workspace: "Reading the workspace",
  create_journey: "Creating the journey",
  add_item: "Adding a step",
  update_item: "Editing a step",
  remove_item: "Removing a step",
  set_audience: "Assigning the audience",
  check_audience: "Running the audience check",
  apply_audience_rule: "Applying an audience rule",
  publish_journey: "Publishing",
  set_enrollment_window: "Setting the enrollment window",
  notify_store_managers: "Notifying store managers",
  schedule_reminder: "Scheduling a nudge",
  openJourney: "Opening the journey",
  showJourney: "Drawing the journey",
  reviewPublish: "Preparing the impact review",
  showLearners: "Setting up the learner view",
  offerWorkflowRecording: "Asking to learn this one",
  awaitDemonstration: "Watching you do it",
  saveLearnedProcedure: "Writing down what it learned",
};

// NOTE: no `agent` field, and this module never imports ./agent.ts — the agent
// is server-only and registers in src/shell/agent-registry.ts under this id.
const myelin: Skin = {
  id: "myelin",
  identity: myelinIdentity,
  themeClass: "theme-myelin",
  Layout: MyelinLayout,
  nav,
  resolvePage,
  Tools: MyelinTools,
  catalog: myelinCatalog,
  suggestions: myelinSuggestions,
  designSkill: MYELIN_DESIGN_SKILL,
  RuntimeProviders: MyelinRuntimeProviders,
  useRuntimeProperties: useMyelinRuntimeProperties,
  Providers: MyelinProviders,
  toolLabels: TOOL_LABELS,
  // No CanvasSurface: the journey map lives in the builder page itself and in
  // `showJourney` cards in the transcript. No sandboxFunctions: no OGUI beat.
};

export default myelin;
