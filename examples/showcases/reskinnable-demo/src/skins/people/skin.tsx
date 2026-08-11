"use client";

import type { ComponentType } from "react";
import { Inbox, Paperclip, Scale, Sprout, Users } from "lucide-react";
import type { NavRoute, Skin, Suggestion } from "@/shell/skin-contract";
import { peopleIdentity } from "./identity";
import { PeopleLayout } from "./layout";
import { PeopleTools } from "./tools";
import { RosterPage } from "./pages/roster";
import { CompensationPage } from "./pages/compensation";
import { RequestsPage } from "./pages/requests";
import { OnboardingPage } from "./pages/onboarding";
import { catalog } from "./catalog";
import { PeopleCanvasSurface } from "./canvas-surface";
import { peopleSuggestions, PACKET_MESSAGE } from "./suggestions";
import { ROWAN_DESIGN_SKILL } from "./design-skill";
import { sandboxFunctions } from "./sandbox-functions";
import {
  PeopleProviders,
  PeopleRuntimeProviders,
  usePeopleRuntimeProperties,
} from "./providers";
import {
  attachOfferLetterByHand,
  sendPacketRequestWithOfferLetter,
} from "./attach-offer-letter";

const nav: NavRoute[] = [
  { segment: "", label: "Roster", icon: Users },
  { segment: "compensation", label: "Compensation", icon: Scale },
  { segment: "requests", label: "Requests", icon: Inbox },
  { segment: "onboarding", label: "Onboarding", icon: Sprout },
];

/**
 * `resolvePage` — not `nav` — is the single source of truth for which segments
 * are valid. It accepts `roster` as an alias for the index that the nav never
 * lists, so a deep link or a typed URL lands somewhere sensible instead of 404.
 */
const PAGES: Record<string, ComponentType> = {
  "": RosterPage,
  roster: RosterPage,
  compensation: CompensationPage,
  requests: RequestsPage,
  onboarding: OnboardingPage,
};

function resolvePage(segments: string[]): ComponentType | null {
  const key = segments.length === 0 ? "" : segments.join("/");
  return PAGES[key] ?? null;
}

/**
 * Human labels for the tool-activity chips, so the transcript reads as phrases
 * rather than as function names. "Optional" in the contract and mandatory in
 * practice: `showCompBands` on a projector says "this is a demo of an API".
 */
const TOOL_LABELS: Record<string, string> = {
  showCompBands: "Pulling up the band ladder",
  showPerson: "Looking someone up",
  showRequestList: "Gathering the requests",
  showCompSummary: "Summarizing compensation",
  setBaseSalary: "Opening the merit increase",
  showRequestQueue: "Setting up the queue view",
  createOnboardingTasks: "Building the onboarding checklist",
  assignBuddy: "Assigning an onboarding buddy",
  postWelcomeNote: "Posting a welcome note",
  createOnboardingPacket: "Filing the onboarding packet",
  approveCompRequest: "Approving the compensation request",
  openBandException: "Filing a band exception",
  finalizeBandException: "Finalizing the band exception",
  offerWorkflowRecording: "Asking to learn this one",
  awaitDemonstration: "Watching you do it",
  saveLearnedProcedure: "Writing down what it learned",
  requestBackgroundCheck: "Ordering a background check",
  scheduleExitInterview: "Scheduling an exit interview",
  sendPolicyReminder: "Sending a policy reminder",
  openHeadcountRequisition: "Opening a requisition",
  render_people_brief: "Building the people review",
};

// ── BEAT 3d: driving the real composer ──────────────────────────────────────
// The framework's suggestion path DROPS attachments, so the pill that must
// carry the offer letter cannot take it. Instead it is intercepted below and
// pushed through the actual composer — stage the file into the hidden input,
// set the textarea, click send — which is the path that correctly consumes an
// attachment on submit.
//
// The chain itself is `@/shell/attach`, reached through `./attach-offer-letter`.
// It replaced a hand-rolled send that lived HERE and sent the prompt whether or
// not staging succeeded, behind a fixed 500 ms sleep that raced the framework's
// base64 encode. Both entry points now abort on any failure and report it to the
// presenter, so neither can be launched into silence — a plain `void` is enough.

// NOTE: no `agent` field, and this module must NEVER import ./agent.ts. Agents
// pull in @copilotkit/runtime, which must not reach the browser bundle; the
// agent registers separately in src/shell/agent-registry.ts under this same id.
const people: Skin = {
  id: "people",
  identity: peopleIdentity,
  themeClass: "theme-people",
  Layout: PeopleLayout,
  nav,
  resolvePage,
  Tools: PeopleTools,
  catalog,
  suggestions: peopleSuggestions,
  designSkill: ROWAN_DESIGN_SKILL,

  // Above CopilotKitProvider — holds the ledger, which `useRuntimeProperties`
  // reads for the signed-in operator.
  RuntimeProviders: PeopleRuntimeProviders,
  useRuntimeProperties: usePeopleRuntimeProperties,
  // Below it — the teach-mode recording context and the sandbox data sync.
  Providers: PeopleProviders,

  CanvasSurface: PeopleCanvasSurface,
  sandboxFunctions,
  toolLabels: TOOL_LABELS,

  // REST-backed like banking and logistics: components read the ledger through
  // `usePeopleLedger()` directly, so nothing flows through `useSkinData` and
  // `useData` is deliberately omitted.

  chatHeaderActions: [
    {
      icon: Paperclip,
      label: "Attach the offer letter",
      // A manual fallback for the presenter if the pill path misbehaves live.
      // It is the fallback, so it must be the LOUDEST link in the chain: if this
      // one fails quietly too, the presenter has nothing left to try.
      // `attachOfferLetterByHand` has already reported before it resolves
      // `false`, and its own catch covers the unexpected, so it cannot reject
      // and the `void` drops nothing.
      onClick: () => void attachOfferLetterByHand(),
    },
  ],

  onSuggestionSelect: (suggestion: Suggestion) => {
    if (suggestion.message !== PACKET_MESSAGE) {
      return false; // every other pill takes the default "send the message" path
    }
    // `true` means "the shell must not run its default send", and that is
    // unconditionally correct for this pill: the default path would send "read
    // Dana's offer letter" with the attachment DROPPED, which is the exact
    // failure beat 3d cannot survive. Claiming the click is only honest because
    // `sendPacketRequestWithOfferLetter` guarantees two outcomes — sent WITH the
    // letter, or aborted and the presenter told why — never `true` plus silence.
    void sendPacketRequestWithOfferLetter();
    return true;
  },
};

export default people;
