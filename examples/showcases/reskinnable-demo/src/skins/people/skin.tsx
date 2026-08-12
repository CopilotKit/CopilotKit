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
import { stageOfferLetterAttachment } from "./attach-offer-letter";

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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Set a React-controlled textarea's value so its onChange actually fires. */
function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function sendPacketRequestWithOfferLetter() {
  const staged = await stageOfferLetterAttachment();
  // Give the built-in attachment handler time to finish base64-encoding the
  // file; sending while an attachment is still "uploading" is silently dropped.
  if (staged) await wait(500);

  const textarea = document.querySelector<HTMLTextAreaElement>(
    'textarea[data-testid="copilot-chat-textarea"]',
  );
  if (!textarea) return;
  setTextareaValue(textarea, PACKET_MESSAGE);
  await wait(60);

  document
    .querySelector<HTMLButtonElement>(
      'button[data-testid="copilot-send-button"]',
    )
    ?.click();
}

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
      onClick: () => void stageOfferLetterAttachment(),
    },
  ],

  onSuggestionSelect: (suggestion: Suggestion) => {
    if (suggestion.message === PACKET_MESSAGE) {
      void sendPacketRequestWithOfferLetter();
      return true; // fully handled — the shell does nothing further
    }
    return false; // every other pill takes the default "send the message" path
  },
};

export default people;
