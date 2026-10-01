"use client";

import type { ComponentType } from "react";
import {
  BadgeCheck,
  BookOpen,
  Building2,
  LayoutDashboard,
  Receipt,
  Users,
  Wallet,
} from "lucide-react";
import type { NavRoute, Skin } from "@/shell/skin-contract";
import { ledgerlineIdentity } from "./identity";
import { LedgerlineLayout } from "./layout";
import { LedgerlineTools } from "./tools";
import { ReportsPage } from "./pages/reports";
import { ReportDetailPage } from "./pages/report-detail";
import { PoliciesPage } from "./pages/policies";
import { OverviewPage } from "./pages/overview";
import { ApprovalsPage } from "./pages/approvals";
import { ReimbursementsPage } from "./pages/reimbursements";
import { CostCentersPage } from "./pages/cost-centers";
import { PeoplePage } from "./pages/people";
import { ledgerlineCatalog } from "./catalog";
import { ledgerlineSuggestions } from "./suggestions";
import { LEDGERLINE_DESIGN_SKILL } from "./design-skill";
import { LedgerlineProviders } from "./providers";
import { useLedgerlineRuntimeProperties } from "./runtime-properties";

const nav: NavRoute[] = [
  { segment: "", label: "Overview", icon: LayoutDashboard },
  { segment: "reports", label: "Expense reports", icon: Receipt },
  { segment: "approvals", label: "Approvals", icon: BadgeCheck },
  { segment: "reimbursements", label: "Reimbursements", icon: Wallet },
  { segment: "cost-centers", label: "Cost centers", icon: Building2 },
  { segment: "people", label: "People", icon: Users },
  { segment: "policies", label: "Policies", icon: BookOpen },
];

/** A `Map`, never a plain object: `segments` is untrusted URL input. */
const PAGES: Map<string, ComponentType> = new Map([
  ["", OverviewPage],
  ["reports", ReportsPage],
  ["approvals", ApprovalsPage],
  ["reimbursements", ReimbursementsPage],
  ["cost-centers", CostCentersPage],
  ["people", PeoplePage],
  ["policies", PoliciesPage],
]);

const detailCache = new Map<string, ComponentType>();

function resolvePage(segments: string[]): ComponentType | null {
  if (segments.length <= 1) return PAGES.get(segments[0] ?? "") ?? null;
  if (segments.length !== 2) return null;
  const [section, id] = segments;
  if (section !== "reports" || !/^[\w-]{1,32}$/.test(id!)) return null;
  let page = detailCache.get(id!);
  if (!page) {
    const Bound = () => <ReportDetailPage reportId={id!} />;
    Bound.displayName = `ReportDetail(${id})`;
    page = Bound;
    detailCache.set(id!, page);
  }
  return page;
}

const TOOL_LABELS: Record<string, string> = {
  listReports: "Listing reports",
  getReport: "Reading the report",
  approveReport: "Approving the report",
  allocateCostCenter: "Allocating a cost center",
  searchPolicies: "Searching policies",
  addNote: "Adding a note",
  reimburseReport: "Scheduling reimbursement",
  loadLearnedSkill: "Loading a learned skill",
  openReport: "Opening the report",
  approveAndReimburse: "Preparing the approval",
};

// NOTE: no agent here; it is registered server-side in agent-registry.ts.
const ledgerline: Skin = {
  id: "ledgerline",
  identity: ledgerlineIdentity,
  themeClass: "theme-ledgerline",
  Layout: LedgerlineLayout,
  nav,
  resolvePage,
  Tools: LedgerlineTools,
  catalog: ledgerlineCatalog,
  suggestions: ledgerlineSuggestions,
  designSkill: LEDGERLINE_DESIGN_SKILL,
  Providers: LedgerlineProviders,
  useRuntimeProperties: useLedgerlineRuntimeProperties,
  toolLabels: TOOL_LABELS,
};

export default ledgerline;
