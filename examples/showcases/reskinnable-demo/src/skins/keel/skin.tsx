"use client";

import type { ComponentType } from "react";
import type { Skin } from "@/shell/skin-contract";
import { keelIdentity } from "@/skins/keel/identity";
import { keelNav } from "@/skins/keel/nav";
import { KeelLayout } from "@/skins/keel/layout";
import { KeelTools } from "@/skins/keel/tools";
import {
  KeelRuntimeProviders,
  useKeelRuntimeProperties,
} from "@/skins/keel/providers";
import { KeelCanvasSurface } from "@/skins/keel/canvas-surface";
import { keelCatalog } from "@/skins/keel/catalog";
import { keelSuggestions } from "@/skins/keel/suggestions";
import { KEEL_DESIGN_SKILL } from "@/skins/keel/design-skill";
import { sandboxFunctions } from "@/skins/keel/sandbox-functions";
import { useKeelData } from "@/skins/keel/data/use-data";
import { DeskPage } from "@/skins/keel/pages/desk";
import { KnowledgePage } from "@/skins/keel/pages/knowledge";
import { DocumentPage } from "@/skins/keel/pages/document";
import { PlaybooksPage } from "@/skins/keel/pages/playbooks";
import { RunsPage } from "@/skins/keel/pages/runs";
import { RunDetailPage } from "@/skins/keel/pages/run-detail";

/** Single-segment routes. Parameterized routes are handled below. */
const PAGES: Record<string, ComponentType> = {
  "": DeskPage,
  knowledge: KnowledgePage,
  playbooks: PlaybooksPage,
  runs: RunsPage,
};

/**
 * Keel is the first skin in this app with PARAMETERIZED routes, so unlike
 * banking's and airline's flat `segments.join("/")` lookup this actually
 * destructures the segment array.
 *
 * `knowledge/<docId>` and `runs/<runId>` always resolve to their detail page —
 * deliberately WITHOUT checking whether the id exists. An unknown id is a valid
 * route with a "not found" body (rendered inside the page), not a 404. Returning
 * null here would 404 a structurally valid URL, which is the wrong signal and
 * would break a citation deep-link into a document that was merely renamed.
 */
function resolvePage(segments: string[]): ComponentType | null {
  if (segments.length === 0) return PAGES[""];
  if (segments.length === 1) return PAGES[segments[0]] ?? null;
  if (segments.length === 2) {
    if (segments[0] === "knowledge") return DocumentPage;
    if (segments[0] === "runs") return RunDetailPage;
  }
  return null;
}

/**
 * Human-readable tool-activity chip labels, present-participle voice to match
 * both shipped skins. Covers the eight frontend tools AND the two server tools
 * — server tools raise activity chips too.
 */
const TOOL_LABELS: Record<string, string> = {
  search_knowledge: "Searching the policy library",
  render_ops_report: "Building the operations report",
  generateSandboxedUi: "Generating an interactive view",
  showSources: "Citing the policy",
  openDocument: "Opening the policy",
  showPlaybook: "Pulling up the playbook",
  startRun: "Starting the process",
  showRun: "Checking the run",
  approveStep: "Recording your approval",
  showApprovals: "Loading the approval queue",
  navigateTo: "Navigating",
};

// NOTE: no `agent` field — agents are server-only, registered in
// src/shell/agent-registry.ts under this same id ("keel"). This module must
// NEVER import agent.ts.
const keel: Skin = {
  id: "keel",
  identity: keelIdentity,
  themeClass: "theme-keel",
  Layout: KeelLayout,
  nav: keelNav,
  resolvePage,
  Tools: KeelTools,
  catalog: keelCatalog,
  suggestions: keelSuggestions,
  designSkill: KEEL_DESIGN_SKILL,
  CanvasSurface: KeelCanvasSurface,
  sandboxFunctions,
  toolLabels: TOOL_LABELS,
  // Persona lives ABOVE CopilotKitProvider so identity flows through the
  // provider's `properties` prop rather than a child racing setProperties.
  RuntimeProviders: KeelRuntimeProviders,
  useRuntimeProperties: useKeelRuntimeProperties,
  useData: useKeelData,
  // `Providers` omitted — nothing in this skin needs to mount below the
  // provider. `chatHeaderActions` and `onSuggestionSelect` omitted — no
  // attachment beat here (that is banking's Q2 invoice).
};

export default keel;
