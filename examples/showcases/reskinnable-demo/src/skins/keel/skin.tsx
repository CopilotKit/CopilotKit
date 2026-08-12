"use client";

import type { ComponentType } from "react";
import { Paperclip } from "lucide-react";
import type { Skin, Suggestion } from "@/shell/skin-contract";
import { keelIdentity } from "@/skins/keel/identity";
import { keelNav } from "@/skins/keel/nav";
import { KeelLayout } from "@/skins/keel/layout";
import { KeelTools } from "@/skins/keel/tools";
import {
  KeelProviders,
  KeelRuntimeProviders,
  useKeelRuntimeProperties,
} from "@/skins/keel/providers";
import { KeelCanvasSurface } from "@/skins/keel/canvas-surface";
import { keelCatalog } from "@/skins/keel/catalog";
import { keelSuggestions } from "@/skins/keel/suggestions";
import { KEEL_DESIGN_SKILL } from "@/skins/keel/design-skill";
import { sandboxFunctions } from "@/skins/keel/sandbox-functions";
import {
  attachBulletinByHand,
  sendBulletinMessage,
  BULLETIN_MESSAGE,
} from "@/skins/keel/attach-bulletin";
import { DeskPage } from "@/skins/keel/pages/desk";
import { KnowledgePage } from "@/skins/keel/pages/knowledge";
import { DocumentPage } from "@/skins/keel/pages/document";
import { PlaybooksPage } from "@/skins/keel/pages/playbooks";
import { RunsPage } from "@/skins/keel/pages/runs";
import { RunDetailPage } from "@/skins/keel/pages/run-detail";

/**
 * Single-segment routes. Parameterized routes are handled below.
 *
 * A `Map` (not a plain object) is load-bearing for security: `segments` comes
 * straight from the URL path after `/keel`, so `segments[0]` is untrusted
 * caller input. A plain-object lookup (`PAGES[segments[0]]`) walks the
 * prototype chain, so `"constructor"`, `"toString"`, `"valueOf"`,
 * `"hasOwnProperty"`, `"__proto__"`, … all resolve truthy and slip past the
 * `?? null` 404 guard — handing the shell a `Function` where a `ComponentType`
 * is declared, so `/keel/constructor` renders a Function and React crashes
 * instead of showing a 404. `Map.get` only ever sees own entries, making that
 * bad state unrepresentable rather than relying on a per-call-site guard.
 * `Record<string, ComponentType>` could not catch this — the annotation was a
 * lie about a plain object. Mirrors the persona-lookup hardening in
 * `intelligence/user-id.ts` (commit ee83907ed8).
 */
const PAGES: Map<string, ComponentType> = new Map([
  ["", DeskPage],
  ["knowledge", KnowledgePage],
  ["playbooks", PlaybooksPage],
  ["runs", RunsPage],
]);

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
  if (segments.length === 0) return PAGES.get("") ?? null;
  if (segments.length === 1) return PAGES.get(segments[0]) ?? null;
  if (segments.length === 2) {
    if (segments[0] === "knowledge") return DocumentPage;
    if (segments[0] === "runs") return RunDetailPage;
  }
  return null;
}

/**
 * Human-readable tool-activity chip labels, present-participle voice to match
 * every other skin. Covers the frontend tools AND the server tools — server
 * tools raise activity chips too. An unlabelled tool falls back to a prettified
 * raw name, which on stage reads as the one tool nobody bothered to name.
 */
const TOOL_LABELS: Record<string, string> = {
  search_knowledge: "Searching the policy library",
  render_ops_report: "Building the operations report",
  render_impact_brief: "Putting the brief on the canvas",
  generateSandboxedUi: "Generating an interactive view",
  showSources: "Citing the policy",
  openDocument: "Opening the policy",
  showPlaybook: "Pulling up the playbook",
  startRun: "Starting the process",
  showRun: "Checking the run",
  approveStep: "Recording your approval",
  showApprovals: "Loading the approval queue",
  showRegisterHealth: "Reading the policy register",
  countersignRelease: "Opening the e-signature card",
  fileImpactBrief: "Filing the impact brief",
  navigateTo: "Navigating",
  // Beat 3c
  showRegister: "Setting the register's controls",
  // Beat 4 — the chip says WHY, so the room reads "it remembered" off the
  // transcript even before the note lands.
  showRegisterSummary: "Applying your saved reading preference",
  recall_memory: "Recalling what it knows about you",
  save_memory: "Remembering this for next time",
  // Beat 5's three writes
  raiseReviewFlag: "Raising a review flag",
  sendOwnerNotice: "Notifying the owning department",
  addDocumentNote: "Posting a note on the record",
  // Beat 6. Deliberately says nothing about a CODE — a chip is on screen and the
  // agent-facing surfaces are the ones that must stay clean, but naming the
  // catalogue anywhere invites the next edit to name it somewhere that matters.
  fileReleaseVariance: "Filing the variance",
  offerWorkflowRecording: "Asking to be shown",
  awaitDemonstration: "Watching you",
  saveLearnedProcedure: "Writing up what it learned",
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
  // `KeelRuntimeProviders` also mounts `KeelLedgerProvider`, so everything below
  // the CopilotKit provider — Tools, the layout, every page and the canvas —
  // reads ONE `GET /ledger` snapshot.
  RuntimeProviders: KeelRuntimeProviders,
  useRuntimeProperties: useKeelRuntimeProperties,

  // BEAT 6 — the teach-mode recorder, which must enclose BOTH the app card (where
  // the operator demonstrates) and the chat card (where the card reading the feed
  // lives). `Providers` mounts BELOW CopilotKitProvider, which is the only mount
  // point that encloses both. See providers.tsx for why a narrower mount fails
  // SILENTLY.
  Providers: KeelProviders,

  // BEAT 3d — both of these exist to serve the attachment beat, and neither is
  // decorative: the framework's suggestion path DROPS attachments, so a pill
  // that must carry a file has to be intercepted here and driven through the
  // real composer instead.
  chatHeaderActions: [
    {
      icon: Paperclip,
      label: "Attach the regulatory bulletin",
      // The manual escape hatch: if the pill path misbehaves on stage the
      // presenter can still stage the file by hand and carry on typing. It is
      // the fallback, so it is the LOUDEST link in the chain — every failure has
      // already been reported by the time this resolves false.
      onClick: () => void attachBulletinByHand(),
    },
  ],

  onSuggestionSelect: (suggestion: Suggestion) => {
    if (suggestion.message !== BULLETIN_MESSAGE) {
      return false; // every other pill takes the default "send the message" path
    }
    // `true` means "the shell must not run its default send", and that is
    // unconditionally correct for this pill: the default path would send the
    // prompt with the attachment DROPPED, so the model would invent the
    // bulletin's contents and file a durable brief that reads perfectly and
    // proves the opposite of the beat. The click is claimed either way, and
    // `sendBulletinMessage` guarantees the only two outcomes are "sent with the
    // bulletin" or "aborted and the presenter was told why".
    void sendBulletinMessage();
    return true;
  },

  // `useData` is OMITTED, and `data/use-data.ts` is gone with it. Keel used to
  // be one of the two in-memory skins: `useKeelData` held runs in `useState` and
  // advanced them on a 900ms client interval. Runs now live in the same REST
  // ledger as the policy register, read through `useKeelDesk()` /
  // `useKeelLedger()`, and elapsed time is settled SERVER-SIDE on every read
  // (`src/app/api/keel/v1/settle-runs.ts`). So `useSkinData<T>()` correctly
  // returns undefined for keel, exactly as it does for the four other
  // REST-backed skins.
};

export default keel;
