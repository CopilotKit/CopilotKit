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
import { stageInvoiceAttachment } from "@/skins/banking/attach-invoice";
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
const PAGES: Record<string, ComponentType> = {
  "": CardsPage,
  cards: CardsPage,
  dashboard: DashboardPage,
  charges: ChargesPage,
  team: TeamPage,
};

function resolvePage(segments: string[]): ComponentType | null {
  const key = segments.length === 0 ? "" : segments.join("/");
  return PAGES[key] ?? null;
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

/**
 * The Q2 report pill is the multimodal beat: it must ride a real PDF attachment
 * so the model reads the invoice. The framework's suggestion path drops
 * attachments, so this pill instead drives the REAL composer — stage the bundled
 * invoice into the attachment queue, type the request, and click send — routing
 * through the composer's onSubmitInput (which consumes the attachment and
 * handles the frontend-tool + Intelligence run lifecycle correctly). Matched by
 * string equality against the suggestion message, so it stays correct
 * regardless of pill order.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Set a React-controlled textarea's value so its onChange fires. */
function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Stage the invoice, type the Q2 request, click send — via the real composer. */
async function sendQ2WithInvoice() {
  const staged = await stageInvoiceAttachment();
  // Let the built-in attachment handler finish base64-encoding the file so the
  // composer's send is not blocked by an "uploading" attachment.
  if (staged) await wait(500);

  const textarea = document.querySelector<HTMLTextAreaElement>(
    'textarea[data-testid="copilot-chat-textarea"]',
  );
  if (!textarea) return;
  setTextareaValue(textarea, Q2_REPORT_MESSAGE);
  await wait(60);

  const sendButton = document.querySelector<HTMLButtonElement>(
    'button[data-testid="copilot-send-button"]',
  );
  sendButton?.click();
}

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
      onClick: () => void stageInvoiceAttachment(),
    },
  ],
  // Intercept the Q2 pill to ride the invoice attachment; every other pill takes
  // the shell's default "send the message" path.
  onSuggestionSelect: (suggestion: Suggestion) => {
    if (suggestion.message === Q2_REPORT_MESSAGE) {
      void sendQ2WithInvoice();
      return true;
    }
    return false;
  },
};

export default banking;
