"use client";

import type { ComponentType } from "react";
import { Paperclip } from "lucide-react";
import type { Skin, Suggestion } from "@/shell/skin-contract";
import { identity } from "@/skins/banking/identity";
import { bankingNav } from "@/skins/banking/nav";
import { LayoutComponent } from "@/skins/banking/layout";
import { BankingTools } from "@/skins/banking/tools";
import {
  BankingProviders,
  BankingRuntimeProviders,
  useBankingRuntimeProperties,
} from "@/skins/banking/providers";
import { BankingCanvasSurface } from "@/skins/banking/canvas-surface";
import { catalog } from "@/skins/banking/catalog";
// Q2_REPORT_MESSAGE lives with the pill it belongs to, so the message the
// catalog renders and the message `onSuggestionSelect` matches on are the same
// value — they cannot drift apart and silently degrade the invoice beat.
import {
  bankingSuggestions,
  Q2_REPORT_MESSAGE,
} from "@/skins/banking/suggestions";
import { NORTHWIND_DESIGN_SKILL } from "@/skins/banking/design-skill";
import { sandboxFunctions } from "@/skins/banking/sandbox-functions";
import {
  attachInvoiceByHand,
  sendQ2WithInvoice,
} from "@/skins/banking/attach-invoice";
import CardsPage from "@/skins/banking/pages/cards";
import DashboardPage from "@/skins/banking/pages/dashboard";
import ChargesPage from "@/skins/banking/pages/charges";
import TeamPage from "@/skins/banking/pages/team";

// Route segments after /banking → page component. Verified against the app's
// pre-cutover routes: `/` served page.tsx (the Credit Cards face view, now
// cards.tsx), `/dashboard` the dashboard, `/charges` the charges table, `/team`
// the roster. `""` and the explicit `"cards"` alias both resolve to the cards
// face; the old `/cards` → dashboard re-export is dropped (dashboard is reached
// via its own segment). Anything else → null → 404.
// A Map, NOT an object literal: an object inherits Object.prototype, so
// PAGES["constructor"] returns a truthy Function and `?? null` never fires.
// /banking/constructor would then sail past the shell's `if (!Page) notFound()`
// and try to render a non-component -- a 500 where a 404 belongs. Same for
// toString, valueOf, hasOwnProperty, __proto__ and the rest of the prototype.
// A Map has no prototype keys, so the ?? is the only gate needed.
// `src/shell/resolve-page-prototype.test.ts` walks every registered skin.
const PAGES = new Map<string, ComponentType>([
  ["", CardsPage],
  ["cards", CardsPage],
  ["dashboard", DashboardPage],
  ["charges", ChargesPage],
  ["team", TeamPage],
]);

function resolvePage(segments: string[]): ComponentType | null {
  const key = segments.length === 0 ? "" : segments.join("/");
  return PAGES.get(key) ?? null;
}

// Human-readable labels for the tool-activity chips (banking-domain; moved off
// the shell wrapper). Anything not listed falls back to a prettified tool name.
// The shell matches on `name === key || name.includes(key)`.
const TOOL_LABELS: Record<string, string> = {
  recall_memory: "Recalling from long-term memory",
  save_memory: "Saving to long-term memory",
  createReport: "Filing the report",
  render_report: "Building the report on the canvas",
  generateSandboxedUi: "Generating an interactive UI",
  showCharges: "Opening the charges page",
  showTransactions: "Pulling up transactions",
  showPendingApprovals: "Loading the approvals queue",
};

// ── BEAT 3d: driving the real composer ──────────────────────────────────────
// The Q2 report pill is the multimodal beat: it must ride a real PDF attachment
// so the model reads the invoice. The framework's suggestion path DROPS
// attachments, so this pill is intercepted below and pushed through the actual
// composer — the only path that consumes an attachment on submit. Matched by
// string equality against the shared message constant, so it stays correct
// regardless of pill order.
//
// The chain itself is `@/shell/attach`, reached through `./attach-invoice`. It
// replaced a hand-rolled send that lived HERE and sent the prompt whether or not
// staging succeeded, behind a fixed 500 ms sleep that raced the framework's
// base64 encode. Both entry points now abort on any failure and report it to the
// presenter, so neither can be launched into silence — a plain `void` is enough.

// NOTE: no `agent` field — agents are server-only, registered in
// src/shell/agent-registry.ts keyed by this same id ("banking"). This module
// must NEVER import agent.ts.
const banking: Skin = {
  id: "banking",
  identity,
  themeClass: "theme-banking",
  Layout: LayoutComponent,
  nav: bankingNav,
  resolvePage,
  Tools: BankingTools,
  Providers: BankingProviders,
  // Auth lives ABOVE CopilotKitProvider so identity flows through the provider's
  // `properties` prop (ordering-independent), not a child racing setProperties.
  RuntimeProviders: BankingRuntimeProviders,
  useRuntimeProperties: useBankingRuntimeProperties,
  CanvasSurface: BankingCanvasSurface,
  catalog,
  suggestions: bankingSuggestions,
  designSkill: NORTHWIND_DESIGN_SKILL,
  sandboxFunctions,
  toolLabels: TOOL_LABELS,
  // banking has no single shared data hook: its components read the REST ledger
  // via useCreditCards (with a cross-instance revalidation bus) and the current
  // member via useAuthContext directly, so nothing flows through useSkinData.
  // `useData` is therefore omitted (the contract makes it optional).
  // The paperclip in the chat header stages the bundled Q2 invoice.
  chatHeaderActions: [
    {
      icon: Paperclip,
      label: "Attach Q2 invoice",
      // The fallback, so it must be the loudest link: if this one fails quietly
      // too, the presenter has nothing left to try. `attachInvoiceByHand` has
      // already reported before it resolves `false`, and its own catch covers
      // the unexpected, so it cannot reject and the `void` drops nothing.
      onClick: () => void attachInvoiceByHand(),
    },
  ],
  // Intercept the Q2 pill to ride the invoice attachment; every other pill takes
  // the shell's default "send the message" path.
  onSuggestionSelect: (suggestion: Suggestion) => {
    if (suggestion.message !== Q2_REPORT_MESSAGE) {
      return false; // every other pill takes the default "send the message" path
    }
    // `true` means "the shell must not run its default send", and that is
    // unconditionally correct for this pill: the default path would send "prepare
    // the Q2 report" with the invoice DROPPED, which is the exact failure beat 3d
    // cannot survive. Claiming the click is only honest because
    // `sendQ2WithInvoice` guarantees two outcomes — sent WITH the invoice, or
    // aborted and the presenter told why — never `true` plus silence.
    void sendQ2WithInvoice();
    return true;
  },
};

export default banking;
