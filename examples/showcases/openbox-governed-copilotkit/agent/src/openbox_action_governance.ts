import { createGovernedCopilotTool } from "@openbox-ai/openbox-sdk/copilotkit";
import type {
  OpenBoxCopilotActionInput,
  OpenBoxCopilotActionResult,
  OpenBoxCopilotResumeInput,
} from "@openbox-ai/openbox-sdk/copilotkit";
import { openBoxCopilotKitAdapter } from "./openbox_governance.js";

/**
 * Governed business tool — SIMPLIFIED / deterministic.
 *
 * Unlike the reference app, this tool performs NO live model call and NO
 * network I/O. `deterministicArtifact` builds a small, static-shaped artifact
 * purely from the input fields so the demo (and its E2E suite) is reproducible:
 * the same input always yields the same output. OpenBox still governs the
 * input and the output around this deterministic execution step.
 */

export type GovernedAction =
  | "create_support_ticket"
  | "send_public_status_update"
  | "issue_large_refund"
  | "view_governance_report";

export interface GovernedActionInput extends OpenBoxCopilotActionInput {
  action: string;
  request: string;
  destination?: string;
  amountUsd?: number;
  fields?: string[];
  audience?: string;
  sensitivity?: string;
}

export type ResumeGovernedActionInput = GovernedActionInput &
  OpenBoxCopilotResumeInput;

type SupportTicketArtifact = {
  type: "support_ticket";
  ticketId: string;
  title: string;
  urgencyLabel: "Low" | "Medium" | "High";
  queue: string;
  status: "created";
  nextStep: string;
};

type StatusUpdateArtifact = {
  type: "status_update";
  channel: string;
  status: "drafted";
  audience: string;
  summary: string;
};

type RefundArtifact = {
  type: "refund";
  referenceId: string;
  status: "processed";
  amountUsd: number;
  recipient: string;
  title: string;
  approvalStatus: "approved";
  memo: string;
  ledgerImpact: string;
  nextStep: string;
};

type GovernanceReportArtifact = {
  type: "governance_report";
  reportId: string;
  status: "generated";
  title: string;
  redacted: boolean;
  audience: string;
  fields: string[];
  records: Array<Record<string, string>>;
};

type GenericActionArtifact = {
  type: "action_summary";
  status: "completed";
  action: string;
  summary: string;
  destination: string | null;
};

export type GovernedActionArtifact =
  | SupportTicketArtifact
  | StatusUpdateArtifact
  | RefundArtifact
  | GovernanceReportArtifact
  | GenericActionArtifact;

export type GovernedActionResult =
  OpenBoxCopilotActionResult<GovernedActionArtifact>;

const TOOL_NAME = "openbox_governed_action";
const TOOL_DESCRIPTION =
  "Execute a realistic governed business action for the OpenBox demo.";

// Shares the adapter with the LangChain middleware so this governed tool
// attaches to the same task workflow (one user task = one OpenBox session).
const governedCopilotTool = createGovernedCopilotTool<
  GovernedActionInput,
  GovernedActionArtifact
>({
  adapter: openBoxCopilotKitAdapter,
  toolName: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  normalizeInput: (input) => input,
  execute: async (input) => deterministicArtifact(input),
});

export async function governAction(
  input: GovernedActionInput,
  config?: unknown,
): Promise<GovernedActionResult> {
  return governedCopilotTool.execute(input, config);
}

export async function resumeGovernedAction(
  input: ResumeGovernedActionInput,
  config?: unknown,
): Promise<GovernedActionResult> {
  return governedCopilotTool.resume(input, config);
}

/**
 * Build a small, static-shaped business artifact from the input fields only.
 * Deterministic: no randomness, no Date.now(), no network, no model call.
 */
function deterministicArtifact(
  input: GovernedActionInput,
): GovernedActionArtifact {
  switch (input.action) {
    case "create_support_ticket":
      return supportTicketArtifact(input);
    case "send_public_status_update":
      return statusUpdateArtifact(input);
    case "issue_large_refund":
      return refundArtifact(input);
    case "view_governance_report":
      return governanceReportArtifact(input);
    default:
      return genericArtifact(input);
  }
}

function supportTicketArtifact(
  input: GovernedActionInput,
): SupportTicketArtifact {
  const request = input.request.toLowerCase();
  const urgencyLabel: SupportTicketArtifact["urgencyLabel"] =
    request.includes("production") || request.includes("outage")
      ? "High"
      : request.includes("blocked") || request.includes("urgent")
        ? "Medium"
        : "Low";
  return {
    type: "support_ticket",
    ticketId: stableReference("SUP", input.request),
    title: sentenceCase(input.request),
    urgencyLabel,
    queue: input.destination || "Internal operations",
    status: "created",
    nextStep: "Review and assign owner",
  };
}

function statusUpdateArtifact(
  input: GovernedActionInput,
): StatusUpdateArtifact {
  return {
    type: "status_update",
    channel: input.destination || "Internal status draft",
    status: "drafted",
    audience: input.audience || "Internal stakeholders",
    summary: sentenceCase(input.request),
  };
}

function refundArtifact(input: GovernedActionInput): RefundArtifact {
  const amountUsd = input.amountUsd ?? 0;
  const recipient = input.destination || "approved account";
  return {
    type: "refund",
    referenceId: stableReference("REF", input.request),
    status: "processed",
    amountUsd,
    recipient,
    title: "Approved Credit Memo",
    approvalStatus: "approved",
    memo: sentenceCase(input.request),
    ledgerImpact: `${formatUsd(amountUsd)} service credit recorded for ${recipient}.`,
    nextStep: "Finance can reconcile the credit memo in the approved system.",
  };
}

function governanceReportArtifact(
  input: GovernedActionInput,
): GovernanceReportArtifact {
  const fields =
    input.fields && input.fields.length > 0
      ? input.fields
      : ["item", "issue", "impact", "next_step"];
  const items = splitBusinessItems(input.request);
  const records = (items.length > 0 ? items : [input.request]).map((item) =>
    recordFromFields(item, fields),
  );
  return {
    type: "governance_report",
    reportId: stableReference("RPT", input.request),
    status: "generated",
    title: "Operations Exception Report",
    redacted: false,
    audience: input.audience || "Internal operations",
    fields,
    records,
  };
}

function genericArtifact(input: GovernedActionInput): GenericActionArtifact {
  return {
    type: "action_summary",
    status: "completed",
    action: input.action,
    summary: sentenceCase(input.request),
    destination: input.destination ?? null,
  };
}

function recordFromFields(
  item: string,
  fields: string[],
): Record<string, string> {
  const base: Record<string, string> = {
    item: titleFromBusinessItem(item),
    issue: sentenceCase(item),
    impact: "Operational follow-up",
    next_step: "Prepare the next action for review.",
    summary: sentenceCase(item),
  };
  return Object.fromEntries(
    fields.map((field) => [field, base[field] ?? sentenceCase(item)]),
  );
}

function splitBusinessItems(request: string): string[] {
  const afterColon = request.includes(":")
    ? request.slice(request.indexOf(":") + 1)
    : request;
  return afterColon
    .replace(/\band\b/gi, ",")
    .split(/[;\n,]/)
    .map((item) => item.replace(/\s+/g, " ").trim().replace(/\.$/, ""))
    .filter((item) => item.length > 0);
}

function titleFromBusinessItem(item: string): string {
  const words = item.trim().split(/\s+/).slice(0, 6);
  return sentenceCase(words.join(" "));
}

/**
 * Deterministic reference id derived only from the seed text — same input
 * always produces the same id (no random bytes, no timestamp).
 */
function stableReference(prefix: string, seed: string): string {
  const hint = seed
    .replace(/[^a-z0-9]+/gi, "")
    .slice(0, 4)
    .toUpperCase()
    .padEnd(4, "X");
  const digest = hashHex(seed);
  return `${prefix}-${hint}-${digest}`;
}

/** Small deterministic 4-char hex digest (FNV-1a) of the seed text. */
function hashHex(seed: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 0x10000).toString(16).toUpperCase().padStart(4, "0");
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Governed action";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).replace(/\.$/, "");
}
