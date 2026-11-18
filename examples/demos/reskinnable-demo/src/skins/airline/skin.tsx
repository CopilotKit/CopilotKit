"use client";

import { Paperclip } from "lucide-react";
import type { Skin, Suggestion } from "@/shell/skin-contract";
import { airlineIdentity } from "./identity";
import { AirlineLayout } from "./layout";
import { AirlineTools } from "./tools";
import { airlineCatalog } from "./catalog";
import { airlineSuggestions } from "./suggestions";
import { AERONOVA_DESIGN_SKILL } from "./design-skill";
import { airlineNav } from "./nav";
import { resolveAirlinePage } from "./pages";
import { AirlineProviders } from "./providers";
import { AirlineCanvasSurface } from "./canvas-surface";
import { useAirlineRuntimeProperties } from "./runtime-properties";
import {
  HOTEL_CONFIRMATION_MESSAGE,
  attachHotelConfirmationByHand,
  sendHotelConfirmationMessage,
} from "./attach-hotel-confirmation";

/**
 * Human labels for the tool-activity chips, so the transcript reads as phrases
 * rather than as function names. "Optional" in the contract and mandatory in
 * practice: `showRebookingSearch` on a projector says "this is a demo of an API".
 */
const TOOL_LABELS: Record<string, string> = {
  showTrips: "Pulling up your trips",
  showFlight: "Pulling up your flight",
  showSeatMap: "Opening the cabin map",
  showLoyalty: "Checking your loyalty status",
  showRedemptions: "Browsing miles redemptions",
  showDisruption: "Checking for flight disruptions",
  trackBaggage: "Tracking your baggage",
  showBoardingPass: "Displaying your boarding pass",
  issueBoardingPass: "Issuing your boarding pass",
  showRebookingOptions: "Finding replacement flights",
  showRebookingSearch: "Setting up the flight search",
  rebookOntoOption: "Reissuing the ticket",
  reseatPassenger: "Moving your seat",
  notifyTripParty: "Letting them know",
  authorizeWithCardConfirmation: "Confirming the card on file",
  fileFareException: "Filing a fare exception",
  fileTripBrief: "Filing the trip brief",
  render_trip_brief: "Opening the trip brief",
  // BEAT 6's teach chain. Labelled in the passenger's language, not the demo's:
  // "offerWorkflowRecording" on a projector announces that the room is watching a
  // scripted mechanism rather than an assistant admitting it does not know something.
  offerWorkflowRecording: "Asking to be shown",
  awaitDemonstration: "Watching you do it",
  saveLearnedProcedure: "Writing down what I saw",
};

// ── BEAT 3d: driving the real composer ──────────────────────────────────────
// The framework's suggestion path DROPS attachments, so the pill that must carry
// the hotel confirmation cannot take it. It is intercepted below and pushed
// through the actual composer — stage the file into the hidden input, set the
// textarea, click send — which is the path that correctly consumes an attachment
// on submit. The chain itself is `@/shell/attach`, reached through
// `./attach-hotel-confirmation`; both entry points abort on any failure and
// report it to the presenter, so neither can be launched into silence.

// NOTE: no `agent` field, and this module must NEVER import ./agent.ts. Agents
// pull in @copilotkit/runtime, which must not reach the browser bundle; the
// agent registers separately in src/shell/agent-registry.ts under this same id.
const airline: Skin = {
  id: "airline",
  identity: airlineIdentity,
  themeClass: "theme-airline",
  Layout: AirlineLayout,
  // Both from their own modules rather than inline literals, so the route table
  // and the sidebar cannot describe two different apps. `resolvePage` — not
  // `nav` — is the source of truth for which segments are valid.
  nav: airlineNav,
  resolvePage: resolveAirlinePage,
  Tools: AirlineTools,
  catalog: airlineCatalog,
  suggestions: airlineSuggestions,
  designSkill: AERONOVA_DESIGN_SKILL,

  // Below CopilotKitProvider: the ONE `GET /ledger` read every page, the layout
  // chrome and `AirlineTools` share, plus the shell's teach-mode recorder.
  Providers: AirlineProviders,

  // BEAT 3d — the durable Trip Brief, read back off the app rather than
  // re-rendered from what the model said. The server tool `render_trip_brief`
  // in `agent.ts` is what opens it.
  CanvasSurface: AirlineCanvasSurface,

  toolLabels: TOOL_LABELS,

  // BEATS 4, 5 and 6 — the client half of per-passenger Intelligence scoping.
  // Forwarded to the runtime as `forwardedProps` and mapped onto a stable memory
  // bucket by the server-safe `airlineIdentifyUser` in `agent-registry.ts`. No
  // `RuntimeProviders`: the hook reads no context, because Aeronova has one
  // account holder and no switcher — see `runtime-properties.ts`.
  useRuntimeProperties: useAirlineRuntimeProperties,

  // REST-backed like banking, logistics, people and commerce: every component
  // reads the ledger through `useAirlineLedger()` (projected onto the check-in
  // shapes by `components/concierge-view.ts`), so nothing flows through
  // `useSkinData` and `useData` is deliberately omitted. It used to be set to
  // `useAirlineData`, a SECOND in-memory seed of Camila's AV1423 — two
  // substrates that could contradict each other on stage. That hook is gone and
  // the REST ledger is the only authority.

  chatHeaderActions: [
    {
      icon: Paperclip,
      label: "Attach the hotel confirmation",
      // A manual fallback for the presenter if the pill path misbehaves live.
      // It is the fallback, so it must be the LOUDEST link in the chain:
      // `attachHotelConfirmationByHand` has already reported before it resolves
      // `false`, and its own catch covers the unexpected, so it cannot reject
      // and the `void` drops nothing.
      onClick: () => void attachHotelConfirmationByHand(),
    },
  ],

  onSuggestionSelect: (suggestion: Suggestion) => {
    if (suggestion.message !== HOTEL_CONFIRMATION_MESSAGE) {
      return false; // every other pill takes the default "send the message" path
    }
    // `true` means "the shell must not run its default send", and that is
    // unconditionally correct for this pill: the default path would send "read
    // my hotel confirmation" with the attachment DROPPED, which is the exact
    // failure beat 3d cannot survive. Claiming the click is only honest because
    // `sendHotelConfirmationMessage` guarantees two outcomes — sent WITH the
    // file, or aborted and the presenter told why — never `true` plus silence.
    void sendHotelConfirmationMessage();
    return true;
  },
};

export default airline;
