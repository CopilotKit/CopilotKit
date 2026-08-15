"use client";

import type { ComponentType } from "react";
import {
  ClipboardList,
  Paperclip,
  PackageSearch,
  RotateCcw,
  Tag,
} from "lucide-react";
import type { NavRoute, Skin, Suggestion } from "@/shell/skin-contract";
import { commerceIdentity } from "./identity";
import { CommerceLayout } from "./layout";
import { CommerceTools } from "./tools";
import { OrdersPage } from "./pages/orders";
import { CatalogPage } from "./pages/catalog";
import { PromotionsPage } from "./pages/promotions";
import { ReturnsPage } from "./pages/returns";
import { catalog } from "./catalog";
import { CommerceCanvasSurface } from "./canvas-surface";
import { commerceSuggestions, RESTOCK_PLAN_MESSAGE } from "./suggestions";
import { BELLWETHER_DESIGN_SKILL } from "./design-skill";
import { sandboxFunctions } from "./sandbox-functions";
import {
  CommerceProviders,
  CommerceRuntimeProviders,
  useCommerceRuntimeProperties,
} from "./providers";
import {
  attachPriceSheetByHand,
  sendRestockRequestWithPriceSheet,
} from "./attach-price-sheet";

const nav: NavRoute[] = [
  { segment: "", label: "Orders", icon: ClipboardList },
  { segment: "catalog", label: "Catalog", icon: PackageSearch },
  { segment: "promotions", label: "Promotions", icon: Tag },
  { segment: "returns", label: "Returns", icon: RotateCcw },
];

/**
 * `resolvePage` — not `nav` — is the single source of truth for which segments
 * are valid. It accepts `orders` as an alias for the index that the nav never
 * lists, so a deep link or a typed URL lands somewhere sensible instead of 404.
 *
 * A `Map` (not a plain object) is load-bearing for security, exactly as in
 * `src/skins/keel/skin.tsx`: `segments` comes straight from the URL path after
 * `/commerce`, so the lookup key is untrusted caller input. A plain-object
 * lookup (`PAGES[key]`) walks the prototype chain, so `"constructor"`,
 * `"toString"`, `"valueOf"`, `"hasOwnProperty"`, `"__proto__"`, … all resolve
 * truthy and slip past the `?? null` 404 guard — handing the shell a `Function`
 * (or `Object.prototype`) where a `ComponentType` is declared, so
 * `/commerce/toString` 500s instead of showing a 404. `Map.get` only ever sees
 * own entries, making that bad state unrepresentable rather than relying on a
 * per-call-site guard. `Record<string, ComponentType>` could not catch this —
 * the annotation was a lie about a plain object.
 */
const PAGES: Map<string, ComponentType> = new Map([
  ["", OrdersPage],
  ["orders", OrdersPage],
  ["catalog", CatalogPage],
  ["promotions", PromotionsPage],
  ["returns", ReturnsPage],
]);

function resolvePage(segments: string[]): ComponentType | null {
  const key = segments.length === 0 ? "" : segments.join("/");
  return PAGES.get(key) ?? null;
}

/**
 * Human labels for the tool-activity chips, so the transcript reads as phrases
 * rather than as function names. "Optional" in the contract and mandatory in
 * practice: `showMarginLadder` on a projector says "this is a demo of an API".
 */
const TOOL_LABELS: Record<string, string> = {
  showMarginLadder: "Pulling up the margin ladder",
  showProduct: "Looking a product up",
  showOrderList: "Gathering the orders",
  showMarginSummary: "Summarizing margin",
  issueRefund: "Opening the refund",
  showOrderQueue: "Setting up the queue view",
  holdOrder: "Putting the order on hold",
  notifyCustomer: "Messaging the customer",
  postOrderNote: "Noting it on the order",
  createRestockPlan: "Filing the restock plan",
  approveMarkdown: "Approving the markdown",
  openMarginWaiver: "Filing a margin waiver",
  finalizeMarginWaiver: "Finalizing the margin waiver",
  offerWorkflowRecording: "Asking to learn this one",
  awaitDemonstration: "Watching you do it",
  saveLearnedProcedure: "Writing down what it learned",
  requestChargebackEvidence: "Pulling chargeback evidence",
  scheduleCarrierPickup: "Booking a carrier pickup",
  sendReviewRequest: "Queueing a review request",
  openSupplierClaim: "Opening a supplier claim",
  render_trade_brief: "Building the trading review",
};

// ── BEAT 3d: driving the real composer ──────────────────────────────────────
// The framework's suggestion path DROPS attachments, so the pill that must carry
// the price sheet cannot take it. Instead it is intercepted below and pushed
// through the actual composer — stage the file into the hidden input, set the
// textarea, click send — which is the path that correctly consumes an attachment
// on submit. All of that (and its fail-loud contract) lives in `@/shell/attach`,
// reached through `./attach-price-sheet`; this module only routes the two entry
// points to it.
//
// This file used to wrap both entry points in a `launchBeat3d` that `.catch`ed
// an unexpected rejection, because a bare `void` here is what once made the
// paperclip fail with nothing in the console. That wrapper is now redundant, not
// merely unfashionable: `attachByHand` and `sendMessageWithAttachment` are each
// wholly inside their own `try`, whose `catch` reports cause `"unexpected"`
// before resolving `false`. Neither can reject, so the `void`s below drop
// nothing — and re-adding a per-skin catch would be the third copy of a rule the
// shell already owns.

// NOTE: no `agent` field, and this module must NEVER import ./agent.ts. Agents
// pull in @copilotkit/runtime, which must not reach the browser bundle; the
// agent registers separately in src/shell/agent-registry.ts under this same id.
const commerce: Skin = {
  id: "commerce",
  identity: commerceIdentity,
  themeClass: "theme-commerce",
  Layout: CommerceLayout,
  nav,
  resolvePage,
  Tools: CommerceTools,
  catalog,
  suggestions: commerceSuggestions,
  designSkill: BELLWETHER_DESIGN_SKILL,

  // Above CopilotKitProvider — holds the ledger, which `useRuntimeProperties`
  // reads for the signed-in operator.
  RuntimeProviders: CommerceRuntimeProviders,
  useRuntimeProperties: useCommerceRuntimeProperties,
  // Below it — the teach-mode recording context and the sandbox data sync.
  Providers: CommerceProviders,

  CanvasSurface: CommerceCanvasSurface,
  sandboxFunctions,
  toolLabels: TOOL_LABELS,

  // REST-backed like banking, logistics and people: components read the ledger
  // through `useCommerceLedger()` directly, so nothing flows through
  // `useSkinData` and `useData` is deliberately omitted.

  chatHeaderActions: [
    {
      icon: Paperclip,
      label: "Attach the vendor price sheet",
      // A manual fallback for the presenter if the pill path misbehaves live.
      // It is the fallback, so it must be the LOUDEST link in the chain: if this
      // one fails quietly too, the presenter has nothing left to try.
      onClick: () => void attachPriceSheetByHand(),
    },
  ],

  onSuggestionSelect: (suggestion: Suggestion) => {
    if (suggestion.message !== RESTOCK_PLAN_MESSAGE) {
      return false; // every other pill takes the default "send the message" path
    }
    // `true` means "the shell must not run its default send", and that is
    // unconditionally correct for this pill: the default path would send "read
    // the attached price sheet" with the attachment DROPPED, which is the exact
    // failure beat 3d cannot survive. So the click is claimed either way, and
    // `sendRestockRequestWithPriceSheet` guarantees the only two outcomes are
    // "sent with the sheet" or "aborted and the presenter was told why" — never
    // the old third outcome of returning `true` and then doing nothing at all.
    void sendRestockRequestWithPriceSheet();
    return true;
  },
};

export default commerce;
