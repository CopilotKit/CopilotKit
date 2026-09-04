"use client";

import { Paperclip } from "lucide-react";
import type { Skin, Suggestion } from "@/shell/skin-contract";
import { execIdentity } from "./identity";
import { ExecLayout } from "./layout";
import { execNav } from "./nav";
import { resolveExecPage } from "./pages";
import { ExecTools, execToolLabels } from "./tools";
import { ExecProviders } from "./providers";
import { useExecRuntimeProperties } from "./runtime-properties";
import { catalog } from "./catalog";
import { execSuggestions, MEMO_NARRATIVE_MESSAGE } from "./suggestions";
import { VANTAGE_DESIGN_SKILL } from "./design-skill";
import { sandboxFunctions } from "./sandbox-functions";
import { attachMemoByHand, sendMemoWithAttachment } from "./attach-memo";

// Human-readable activity-chip labels for this skin's own tools. `execToolLabels`
// (tools.tsx) covers the report/metric/memory beats; the five FRONTEND tool
// labels below — beat 6's teach chain (offer/await/save), beat 3a's
// countersign card (refused the first time, requested again at the end of
// the arc), and beat 3c's `navigateTo` — are added HERE (not there) on
// reviewer recommendation so the teach-chain and countersign chips narrate
// the arc the room is watching: it does not know, it asks to be shown, it
// watches, it writes up what it learned, and then it asks again for the
// countersign it was refused the first time. Mirrors logistics' beat-6
// labels (`src/skins/logistics/skin.tsx`). `generateSandboxedUi` is the
// platform's OGUI middleware tool rather than one of this skin's
// registrations; it is labelled here for the same reason banking, logistics
// and keel label it (`src/skins/logistics/skin.tsx`). Unlisted tools
// fall back to a prettified raw name.
const TOOL_LABELS: Record<string, string> = {
  ...execToolLabels,
  offerWorkflowRecording: "Asking to be shown",
  awaitDemonstration: "Watching the demonstration",
  saveLearnedProcedure: "Writing up what it learned",
  confirmPublishCountersign: "Requesting the countersign",
  navigateTo: "Navigating",
  generateSandboxedUi: "Generating an interactive view",
};

// NOTE: no `agent` field — agents are server-only, registered in
// src/shell/agent-registry.ts keyed by this same id ("exec"). This module
// must NEVER import agent.ts.
const exec: Skin = {
  id: "exec",
  identity: execIdentity,
  themeClass: "theme-exec",
  Layout: ExecLayout,
  nav: execNav,
  resolvePage: resolveExecPage,
  Tools: ExecTools,
  Providers: ExecProviders,
  // No `RuntimeProviders`: exec has one persona (the chief of staff) and no
  // switcher, so `useExecRuntimeProperties` reads no context and returns a
  // frozen module constant — airline's pattern, not banking's.
  useRuntimeProperties: useExecRuntimeProperties,
  // No `CanvasSurface`: exec ships no a2ui report tool because its blocks
  // render INLINE in chat, making it the second skin without one (bookstore
  // is the other — `src/skins/bookstore/skin.tsx`). The shared canvas
  // (`src/shell/canvas/report-canvas.tsx`) handles this by rendering nothing
  // for a surface kind it has no renderer for — a blank region, not a crash.
  catalog,
  suggestions: execSuggestions,
  designSkill: VANTAGE_DESIGN_SKILL,
  sandboxFunctions,
  toolLabels: TOOL_LABELS,
  // No `useData`: exec is REST-backed and reads its own ledger through its own
  // context (`useExecLedger()`), so `useSkinData<T>()` correctly returns
  // undefined here — banking's and logistics' pattern.
  // The paperclip in the chat header stages the generated department budget
  // memo PDF.
  chatHeaderActions: [
    {
      icon: Paperclip,
      label: "Attach department budget memo",
      // The manual fallback: if the pill path misbehaves on stage, the
      // presenter can still stage the memo by hand and carry on typing. It is
      // the fallback, so it must be the loudest link in the chain —
      // `attachMemoByHand` has already reported before it resolves `false`,
      // and its own catch covers the unexpected, so the `void` drops nothing.
      onClick: () => void attachMemoByHand(),
    },
  ],
  // Intercept the memo pill to ride the attachment; every other pill takes the
  // shell's default "send the message" path. Matched by string equality
  // against the shared message constant, so it stays correct regardless of
  // pill order.
  onSuggestionSelect: (suggestion: Suggestion) => {
    if (suggestion.message !== MEMO_NARRATIVE_MESSAGE) {
      return false; // every other pill takes the default "send the message" path
    }
    // `true` means "the shell must not run its default send", and that is
    // unconditionally correct for this pill: the default path would send the
    // narrative prompt with the memo DROPPED, which is the exact failure beat
    // 3d cannot survive. Claiming the click is only honest because
    // `sendMemoWithAttachment` guarantees two outcomes — sent WITH the memo, or
    // aborted and the presenter told why — never `true` plus silence.
    void sendMemoWithAttachment();
    return true;
  },
};

export default exec;
