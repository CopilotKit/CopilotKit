import { randomBytes, randomUUID } from "node:crypto";
import type {
  SpanData,
  WorkflowVerdict,
} from "@openbox-ai/openbox-sdk/core-client";
import { createGovernedCopilotTool } from "@openbox-ai/openbox-sdk/copilotkit";
import type {
  OpenBoxCopilotActionInput,
  OpenBoxCopilotTimingEvent,
} from "@openbox-ai/openbox-sdk/copilotkit";
import type { RunnableConfig } from "@langchain/core/runnables";
import { invokeConfiguredJsonChat } from "./openai_config.js";
import { openBoxCopilotKitAdapter } from "./openbox_governance.js";

export type GovernedAction =
  | "open_operations_queue"
  | "send_public_status_update"
  | "create_support_ticket"
  | "export_governance_identifiers"
  | "disable_production_payments"
  | "issue_large_refund"
  | "review_data_handoff"
  | "submit_manual_request"
  | "view_governance_report"
  | "draft_policy_constrained_message";

export interface GovernedActionInput extends OpenBoxCopilotActionInput {
  action: GovernedAction;
  request: string;
  destination?: string;
  amountUsd?: number;
  fields?: string[];
  audience?: string;
  manualInput?: string;
  sensitivity?: "public" | "internal" | "confidential" | "restricted";
  choiceId?: "minimal" | "growth" | "sensitive";
}

export interface ResumeGovernedActionInput extends GovernedActionInput {
  workflowId: string;
  runId: string;
  activityId: string;
  approvalId?: string;
  governanceEventId?: string;
  approved?: boolean;
}

export type GovernedActionResult = {
  status:
    | "executed"
    | "constrained"
    | "blocked"
    | "halted"
    | "session_halted"
    | "approval_required"
    | "rejected"
    | "approval_pending"
    | "error";
  verdict: WorkflowVerdict["arm"] | "error";
  executed: boolean;
  action: GovernedAction;
  request: string;
  destination: string | null;
  amountUsd: number | null;
  reason: string;
  message: string;
  riskScore?: number;
  trustTier?: string | number;
  guardrailsResult?: WorkflowVerdict["guardrailsResult"];
  redactionSummary?: string;
  artifact?: GovernedActionArtifact;
  choiceId?: GovernedActionInput["choiceId"] | null;
  workflowId?: string;
  runId?: string;
  activityId?: string;
  approvalId?: string;
  governanceEventId?: string;
  expiresAt?: string;
  session?: OpenBoxSessionState;
};

type GovernedActionArtifact =
  | {
      type: "operations_queue";
      status: "ready";
      title: string;
      generatedAt: string;
      queue: {
        name: string;
        owner: string;
        environment: string;
        status: string;
      };
      items: Array<{
        request: string;
        category: string;
        status: string;
        risk: string;
        nextStep: string;
      }>;
      metrics: Array<{
        label: string;
        value: string;
        detail: string;
      }>;
      recentActivity: Array<{
        reference: string;
        status: string;
        startedAt: string;
        lastEvent: string;
      }>;
    }
  | {
      type: "support_ticket";
      ticketId: string;
      title: string;
      urgencyLabel: "Low" | "Medium" | "High";
      queue: string;
      status: "created";
      nextStep: string;
    }
  | {
      type: "status_update";
      channel: string;
      status: "drafted";
      summary: string;
    }
  | {
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
    }
  | {
      type: "data_handoff";
      status: "prepared";
      destination: string;
      fields: string[];
      audience: string;
      records: Array<Record<string, string>>;
      sourceContext?: string;
      redacted: boolean;
    }
  | {
      type: "manual_submission";
      status: "submitted";
      queue: string;
      summary: string;
      sourceContext?: string;
      sensitivity: string;
    }
  | {
      type: "governance_report";
      status: "generated";
      title: string;
      redacted: boolean;
      records: Array<Record<string, string>>;
      sourceContext?: string;
    }
  | {
      type: "policy_draft";
      status: "drafted";
      channel: string;
      body: string;
      sourceContext?: string;
      removedContext?: string[];
      releaseCheck?: Array<{
        found: string;
        sourceValue: string;
        releasedAs: string;
      }>;
      redacted: boolean;
    };

type JsonRecord = Record<string, unknown>;

export type OpenBoxSessionState =
  | { status: "active" }
  | {
      status: "halted";
      reason: string;
      haltedAt: string;
      workflowId?: string;
      runId?: string;
      activityId?: string;
    };

const WORKFLOW_TYPE = "CopilotKitGovernedAction";
const TASK_QUEUE = "langgraph";
const CORE_TIMEOUT_MS = 180_000;
const TOOL_NAME = "openbox_governed_action";
const TOOL_DESCRIPTION =
  "Execute a realistic business action for the OpenBox governance demo.";
const OPENBOX_TIMING_STATE_KEY = "openboxTimingEvent";

// Shared with the LangChain middleware so governed tools attach to the same
// task workflow (one user task = one OpenBox session).
const governedCopilotTool = createGovernedCopilotTool<
  GovernedActionInput,
  GovernedActionArtifact | undefined
>({
  adapter: openBoxCopilotKitAdapter,
  toolName: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  normalizeInput: normalizeGovernedInput,
  execute: async (input) => executionArtifact(input),
  spanProfile,
  onTimingEvent: emitOpenBoxTimingEvent,
});

export async function governAction(
  input: GovernedActionInput,
  config?: RunnableConfig,
): Promise<GovernedActionResult> {
  const timer = startTiming(`governAction:${input.action}`);
  return timer.done(
    (await governedCopilotTool.execute(input, config)) as GovernedActionResult,
  );
}

export async function resumeGovernedAction(
  input: ResumeGovernedActionInput,
  config?: RunnableConfig,
): Promise<GovernedActionResult> {
  const timer = startTiming(`resumeGovernedAction:${input.action}`);
  return timer.done(
    (await governedCopilotTool.resume(input, config)) as GovernedActionResult,
  );
}

async function emitOpenBoxTimingEvent(
  event: OpenBoxCopilotTimingEvent,
  context: { input: GovernedActionInput; runtimeConfig?: unknown },
) {
  if (!canEmitCopilotKitState(context.runtimeConfig)) return;
  try {
    const { copilotkitEmitState } =
      await import("@copilotkit/sdk-js/langgraph");
    const runtimeConfig = context.runtimeConfig as RunnableConfig;
    const payload = {
      schemaVersion: "openbox.copilotkit.timing.v1",
      toolName: TOOL_NAME,
      action: context.input.action,
      request: context.input.request,
      event,
      emittedAt: new Date().toISOString(),
    };
    await copilotkitEmitState(runtimeConfig, {
      [OPENBOX_TIMING_STATE_KEY]: payload,
    });
  } catch (error) {
    console.warn(
      `[openbox-governed-copilotkit] timing event failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function canEmitCopilotKitState(config: unknown): config is RunnableConfig {
  return Boolean(
    config &&
    typeof config === "object" &&
    "callbacks" in config &&
    (config as { callbacks?: unknown }).callbacks,
  );
}

const BUSINESS_CONTEXT_FIELDS = [
  "item",
  "issue",
  "impact",
  "next_step",
  "summary",
  "service_tier",
  "timeline",
  "owner_note",
  "customer_safe_detail",
  "internal_context",
  "source_value",
  "released_as",
] as const;

const DEFAULT_EXCEPTION_FIELDS = [
  "item",
  "issue",
  "impact",
  "next_step",
] as const;

const BUSINESS_CONTEXT_FIELD_SET = new Set<string>(BUSINESS_CONTEXT_FIELDS);

function normalizeGovernedInput<T extends GovernedActionInput>(input: T): T {
  const validFields = normalizeFields(input.fields);
  const canonicalInput = stripIrrelevantOptionalFields(
    canonicalizeGovernedAction(input, validFields),
  );

  if (canonicalInput.action === "view_governance_report") {
    return {
      ...canonicalInput,
      destination: undefined,
      fields: validFields.length ? validFields : [...DEFAULT_EXCEPTION_FIELDS],
    } as T;
  }

  if (canonicalInput.action === "review_data_handoff") {
    const choiceId = normalizeHandoffChoice(canonicalInput, validFields);
    const profile = handoffChoiceProfile(choiceId);
    return {
      ...canonicalInput,
      choiceId,
      destination: profile.destination,
      audience: profile.audience,
      fields: profile.fields,
      sensitivity: profile.sensitivity,
    } as T;
  }

  if (canonicalInput.action === "submit_manual_request") {
    return {
      ...canonicalInput,
      destination: canonicalInput.destination || "Operations review",
      sensitivity: canonicalInput.sensitivity,
    } as T;
  }

  return {
    ...canonicalInput,
    fields: validFields.length ? validFields : canonicalInput.fields,
  } as T;
}

function stripIrrelevantOptionalFields<T extends GovernedActionInput>(
  input: T,
): T {
  const cleaned = Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (typeof value === "string" && value.trim() === "") return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }),
  ) as T;

  if (cleaned.action !== "submit_manual_request") {
    delete (cleaned as Partial<GovernedActionInput>).manualInput;
  }
  if (cleaned.action !== "review_data_handoff") {
    delete (cleaned as Partial<GovernedActionInput>).choiceId;
  }
  if (cleaned.action !== "issue_large_refund") {
    delete (cleaned as Partial<GovernedActionInput>).amountUsd;
  }

  return cleaned;
}

function canonicalizeGovernedAction<T extends GovernedActionInput>(
  input: T,
  validFields: string[],
): T {
  const text = [
    input.request,
    input.destination,
    input.manualInput,
    ...(input.fields ?? []),
    ...validFields,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const mentionsOpenBoxIdentifier =
    /\b(openbox|session|workflow|control|governance)\b/.test(text) &&
    /\b(identifier|identifiers|ids|id|session id|workflow id)\b/.test(text);
  const asksExternalSend =
    /\b(send|export|share|forward|copy|dump)\b/.test(text) ||
    /\bpersonal\s+gmail\b/.test(text) ||
    /\bexternal\b/.test(text);

  if (mentionsOpenBoxIdentifier && asksExternalSend) {
    return {
      ...input,
      action: "export_governance_identifiers",
      destination: /\bpersonal\s+gmail\b/.test(text)
        ? "personal Gmail"
        : input.destination,
    } as T;
  }

  return input;
}

type HandoffChoiceId = NonNullable<GovernedActionInput["choiceId"]>;

function normalizeHandoffChoice(
  input: GovernedActionInput,
  validFields: string[],
): HandoffChoiceId {
  if (
    input.choiceId === "minimal" ||
    input.choiceId === "growth" ||
    input.choiceId === "sensitive"
  ) {
    return input.choiceId;
  }
  const requestText = [
    input.request,
    input.destination,
    input.manualInput,
    ...(input.fields ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const asksForDirectSourceFields =
    /\b(direct\s+source\s+fields?|direct\s+identifiers?|internal\s+identifiers?)\b/.test(
      requestText,
    ) || /\b(source|agent|session|workflow)[_\s-]?ids?\b/.test(requestText);
  if (
    input.sensitivity === "restricted" ||
    asksForDirectSourceFields ||
    validFields.some((field) =>
      ["source_value", "internal_context"].includes(field),
    )
  ) {
    return "sensitive";
  }
  if (
    input.sensitivity === "confidential" ||
    validFields.some((field) =>
      ["usage_tier", "health_score", "expansion_signal"].includes(field),
    )
  ) {
    return "growth";
  }
  return "minimal";
}

function handoffChoiceProfile(choiceId: HandoffChoiceId): {
  destination: string;
  audience: string;
  fields: string[];
  sensitivity: GovernedActionInput["sensitivity"];
} {
  if (choiceId === "sensitive") {
    return {
      destination: "External review workspace",
      audience: "External reviewer",
      fields: [
        "summary",
        "service_tier",
        "timeline",
        "owner_note",
        "source_value",
        "internal_context",
      ],
      sensitivity: "restricted",
    };
  }
  if (choiceId === "growth") {
    return {
      destination: "External review workspace",
      audience: "External reviewer",
      fields: ["summary", "service_tier", "timeline", "owner_note", "impact"],
      sensitivity: "confidential",
    };
  }
  return {
    destination: "External review workspace",
    audience: "External reviewer",
    fields: ["summary", "service_tier", "timeline", "owner_note"],
    sensitivity: "internal",
  };
}

function normalizeFields(fields?: string[]): string[] {
  if (!Array.isArray(fields)) return [];
  return fields
    .map((field) => field.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter((field) => BUSINESS_CONTEXT_FIELD_SET.has(field));
}

async function executionArtifact(
  input: GovernedActionInput,
): Promise<GovernedActionArtifact | undefined> {
  if (input.action === "open_operations_queue") {
    return operationsQueueArtifact(input);
  }

  if (input.action === "create_support_ticket") {
    return generateBusinessArtifact(input, {
      type: "support_ticket",
      ticketId: stableReference("SUP", input.request),
      title: sentenceCase(input.request),
      urgencyLabel: input.request.toLowerCase().includes("production")
        ? "High"
        : input.request.toLowerCase().includes("blocked")
          ? "Medium"
          : "Low",
      queue: input.destination || "Internal operations",
      status: "created",
      nextStep: "Review and assign owner",
    });
  }

  if (input.action === "send_public_status_update") {
    return generateBusinessArtifact(input, {
      type: "status_update",
      channel: input.destination || "Internal status draft",
      status: "drafted",
      summary: sentenceCase(input.request),
    });
  }

  if (input.action === "issue_large_refund") {
    const amountUsd = input.amountUsd ?? 0;
    const recipient = input.destination || "approved account";
    return generateBusinessArtifact(input, {
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
    });
  }

  if (input.action === "review_data_handoff") {
    const evidence = businessEvidenceFromRequest(input, {
      defaultFields: ["summary", "service_tier", "timeline", "owner_note"],
    });
    return generateBusinessArtifact(
      input,
      {
        type: "data_handoff",
        status: "prepared",
        destination: input.destination || "External review workspace",
        fields: input.fields?.length
          ? input.fields
          : ["summary", "service_tier", "timeline", "owner_note"],
        audience: input.audience || "External reviewer",
        records: evidence.records,
        sourceContext:
          input.choiceId === "growth" ? evidence.sourceContext : undefined,
        redacted: false,
      },
      evidence,
    );
  }

  if (input.action === "submit_manual_request") {
    return generateBusinessArtifact(input, {
      type: "manual_submission",
      status: "submitted",
      queue: input.destination || "Operations review",
      summary: sentenceCase(input.manualInput || input.request),
      sensitivity: input.sensitivity || "internal",
    });
  }

  if (input.action === "view_governance_report") {
    const evidence = businessEvidenceFromRequest(input, {
      defaultFields: ["item", "issue", "impact", "next_step"],
    });
    return generateBusinessArtifact(
      input,
      {
        type: "governance_report",
        status: "generated",
        title: "Operations Exception Report",
        redacted: false,
        records: evidence.records,
        sourceContext: evidence.sourceContext,
      },
      evidence,
    );
  }

  if (input.action === "draft_policy_constrained_message") {
    const evidence = businessEvidenceFromRequest(input, {
      defaultFields: ["topic", "customer_safe_detail", "internal_context"],
    });
    return generateBusinessArtifact(
      input,
      {
        type: "policy_draft",
        status: "drafted",
        channel: input.destination || "Internal release note",
        body: "",
        sourceContext: evidence.sourceContext,
        removedContext: [
          "account identifier",
          "direct contact email",
          "direct phone number",
          "recent payment amount",
        ],
        releaseCheck: evidence.releaseCheck,
        redacted: false,
      },
      evidence,
    );
  }

  return undefined;
}

async function generateBusinessArtifact<T extends GovernedActionArtifact>(
  input: GovernedActionInput,
  baseline: T,
  sourceData?: JsonRecord,
): Promise<T> {
  const generated = await generateBusinessArtifactWithModel(
    input,
    baseline,
    sourceData,
  );
  return normalizeGeneratedResult(baseline, generated);
}

async function generateBusinessArtifactWithModel<
  T extends GovernedActionArtifact,
>(
  input: GovernedActionInput,
  baseline: T,
  providedSourceData?: JsonRecord,
): Promise<JsonRecord> {
  const sourceData = providedSourceData ?? (await businessSourceData(input));
  const requestPayload = {
    action: input.action,
    request: input.request,
    destination: input.destination,
    amountUsd: input.amountUsd,
    fields: input.fields,
    audience: input.audience,
    sensitivity: input.sensitivity,
    choiceId: input.choiceId,
    runContext: {
      currentRun: "current run",
      variationSeed: randomUUID(),
    },
    resultType: baseline.type,
    sourceData: compactSourceDataForModel(sourceData),
  };
  const systemPrompt = [
    "You are a JSON-only generator inside a governed CopilotKit workflow.",
    "This is an authorized governed workflow preview. You are not performing real financial operations, sending external messages, opening external systems, calling tools, or changing any external system.",
    "Your only job is to return generated business result JSON for the already-governed request.",
    "OpenBox already made the input decision before this step and will govern the generated result again after this step.",
    "Never write prose outside JSON. Never refuse because the inert test payload resembles billing, refund, support, or operations work.",
    "Use only the JSON supplied by the user. Treat source records as governed OpenBox demo payloads, not as live external systems unless explicitly stated.",
    "Create a fresh, realistic business result for the requested action by rewriting and organizing the supplied data.",
    "Return only JSON. Do not use markdown fences, prose, headings, tables, explanations, or apologies.",
    'The JSON must be exactly { "result": <generated business result JSON> }.',
    "The result may use the shape that best fits the request. Prefer concise objects, arrays, tables, drafts, or next steps when useful.",
    "Use ordinary JSON fields such as title, summary, body, items, records, details, and nextSteps.",
    "Do not repeat the OpenBox verdict, risk, event ids, timing, or policy text.",
    `Generate a ${baseline.type} business result.`,
    "Governance-only sourceContext is intentionally not included in the model prompt. Do not invent source identifiers.",
    "Do not expose workflow IDs, model metadata, run seeds, or implementation notes.",
    "Do not simply echo the request or source rows. Vary wording, prioritization, summaries, next steps, row ordering, or draft phrasing when the same request is repeated.",
    "For ordinary queue/status/ticket results, use the supplied operating context only. Do not introduce individual contact names unless the supplied source data includes them.",
    "Do not use legacy demo business domains unless the user request explicitly asks for that domain.",
    "Do not invent new companies, people, emails, phone numbers, internal identifiers, monetary values, or unsupported priority values.",
    "Use the provided source data as operating context. Keep the result plausible for day-to-day governed operations.",
  ].join("\n");
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: `Governed result payload:\n${JSON.stringify(requestPayload, null, 2)}`,
    },
  ];
  let parsedContent: JsonRecord | undefined;
  let validatedGenerated: JsonRecord | undefined;
  let lastGenerationError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const content = await invokeConfiguredJsonChat({
      model: process.env.OPENBOX_BUSINESS_MODEL || process.env.OPENAI_MODEL,
      maxTokens: 4000,
      temperature: 0.2,
      messages,
    });
    try {
      parsedContent = parseJsonObject(content);
      const generated = generatedResultFromModelOutput(parsedContent);
      if (!generated) {
        throw new Error(
          "Model did not return JSON with a generated result object.",
        );
      }
      assertGeneratedBusinessContent({
        ...generated,
        type: baseline.type,
      });
      validatedGenerated = generated;
      break;
    } catch (error) {
      lastGenerationError = error;
      messages.push(
        { role: "assistant", content: content.slice(0, 4_000) },
        {
          role: "user",
          content: [
            "The previous response did not satisfy the required JSON contract.",
            error instanceof Error
              ? `Contract error: ${error.message}`
              : undefined,
            'Return only valid JSON in exactly this shape: { "result": { "title": "...", "summary": "...", "items": [ ... ] } }.',
          ]
            .filter(Boolean)
            .join("\n"),
        },
      );
    }
  }
  if (!validatedGenerated) {
    throw lastGenerationError instanceof Error
      ? lastGenerationError
      : new Error("Model did not return parseable JSON.");
  }
  return validatedGenerated;
}

function normalizeGeneratedResult<T extends GovernedActionArtifact>(
  baseline: T,
  generated: JsonRecord,
): T {
  const normalized = preserveGovernanceOwnedResultFields(baseline, generated);
  assertGeneratedBusinessContent(normalized);
  return normalized as T;
}

function preserveGovernanceOwnedResultFields<T extends GovernedActionArtifact>(
  baseline: T,
  generated: JsonRecord,
): JsonRecord {
  const preserved: JsonRecord = { ...generated };
  preserved.type = baseline.type;
  if ("status" in baseline) {
    preserved.status = baseline.status;
  }
  if ("redacted" in baseline) {
    preserved.redacted = baseline.redacted;
  }
  if ("sourceContext" in baseline) {
    const sourceContext = baseline.sourceContext;
    if (sourceContext !== undefined) preserved.sourceContext = sourceContext;
    else delete preserved.sourceContext;
  }
  if ("releaseCheck" in baseline) {
    const releaseCheck = baseline.releaseCheck;
    if (releaseCheck !== undefined) preserved.releaseCheck = releaseCheck;
    else delete preserved.releaseCheck;
  }
  return preserved;
}

function assertGeneratedBusinessContent(result: JsonRecord): void {
  const visibleContent = omitModelSensitiveFields({
    ...result,
    type: undefined,
    status: undefined,
    sourceContext: undefined,
    guardrailsResult: undefined,
    releaseCheck: undefined,
    redacted: undefined,
  });
  if (!textFromGeneratedResult(visibleContent).trim()) {
    throw new Error(
      `Model did not generate visible business content for ${String(result.type || "result")}.`,
    );
  }
}

function generatedResultFromModelOutput(
  value: JsonRecord,
): JsonRecord | undefined {
  if (isJsonRecord(value.result)) return value.result;
  return undefined;
}

function textFromGeneratedResult(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    return value.map(textFromGeneratedResult).filter(Boolean).join("\n");
  }
  if (isJsonRecord(value)) {
    return Object.entries(value)
      .filter(
        ([key]) => !["type", "status", "queue", "sensitivity"].includes(key),
      )
      .map(
        ([key, entry]) =>
          `${sentenceCase(key)}: ${textFromGeneratedResult(entry)}`,
      )
      .filter((entry) => !/:\s*$/.test(entry))
      .join("\n");
  }
  return "";
}

function compactSourceDataForModel(sourceData: JsonRecord): JsonRecord {
  return omitModelSensitiveFields(sourceData) as JsonRecord;
}

function omitModelSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitModelSensitiveFields);
  if (!isJsonRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          key !== "sourceContext" &&
          key !== "guardrailsResult" &&
          key !== "releaseCheck" &&
          key !== "a2uiSurface",
      )
      .map(([key, item]) => [key, omitModelSensitiveFields(item)]),
  );
}

function parseJsonObject(text: string): JsonRecord {
  const direct = tryParseJsonObject(text.trim());
  if (direct) return direct;
  throw new Error("Model did not return parseable JSON.");
}

function tryParseJsonObject(text: string): JsonRecord | undefined {
  try {
    const parsed = JSON.parse(text);
    return isJsonRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function businessSourceData(
  input: GovernedActionInput,
): Promise<JsonRecord> {
  return {
    requestContext: {
      action: input.action,
      request: input.request,
      destination: input.destination,
      audience: input.audience,
      sensitivity: input.sensitivity,
      fields: input.fields,
    },
  };
}

async function operationsQueueArtifact(
  input: GovernedActionInput,
): Promise<GovernedActionArtifact> {
  const items = businessQueueItemsFromRequest(input.request);
  const itemCount = items.length;

  return generateBusinessArtifact(
    input,
    {
      type: "operations_queue",
      status: "ready",
      title: "Operations Queue",
      generatedAt: "current run",
      queue: {
        name: "Daily operations queue",
        owner: "Operations team",
        environment: "business operations",
        status: "ready",
      },
      items,
      metrics: [
        {
          label: "Queue items",
          value: String(itemCount),
          detail: `${itemCount} item${itemCount === 1 ? "" : "s"} supplied in the request.`,
        },
        {
          label: "Ready now",
          value: String(items.filter((item) => item.status === "ready").length),
          detail: "Items that can move forward without extra clarification.",
        },
        {
          label: "Needs review",
          value: String(items.filter((item) => item.status !== "ready").length),
          detail: "Items that need an owner, dependency, or follow-up check.",
        },
        {
          label: "Owner",
          value: "Ops",
          detail:
            "Operations team can take the next action after governance review.",
        },
      ],
      recentActivity: items.slice(0, 5).map((item, index) => ({
        reference: `queue-${index + 1}`,
        status: item.status,
        startedAt: "current run",
        lastEvent: item.nextStep,
      })),
    },
    operationsQueueSourceData(input, items),
  );
}

type BusinessEvidence = {
  records: Array<Record<string, string>>;
  sourceContext: string;
  releaseCheck: Array<{
    found: string;
    sourceValue: string;
    releasedAs: string;
  }>;
};

function businessEvidenceFromRequest(
  input: GovernedActionInput,
  options: {
    defaultFields: string[];
  },
): BusinessEvidence {
  const fields = input.fields?.length ? input.fields : options.defaultFields;
  const records = businessRecordsFromRequest(input.request, fields);
  const sourceContext = [
    "Business source context reviewed before release:",
    input.request,
    input.manualInput ? `Manual note: ${input.manualInput}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    records,
    sourceContext,
    releaseCheck: releaseCheckFromText(sourceContext),
  };
}

function businessRecordsFromRequest(
  request: string,
  fields: string[],
): Array<Record<string, string>> {
  const items = splitBusinessItems(request);
  if (items.length === 0) {
    throw new Error(
      "Business result generation requires concrete details in the user request.",
    );
  }
  const sourceRecords = items.map((item) => recordForBusinessItem(item));
  return sourceRecords.map((record) =>
    Object.fromEntries(fields.map((field) => [field, record[field] ?? ""])),
  );
}

function recordForBusinessItem(item: string): Record<string, string> {
  return {
    item: titleFromBusinessItem(item),
    issue: sentenceCase(item),
    impact: impactForBusinessItem(item),
    next_step: nextStepForBusinessItem(item),
    summary: sentenceCase(item),
    service_tier: serviceTierForBusinessItem(item),
    timeline: timelineForBusinessItem(item),
    owner_note: ownerNoteForBusinessItem(item),
    customer_safe_detail: customerSafeDetailForBusinessItem(item),
    internal_context: item,
    source_value: sensitiveValuesFromText(item).join(", "),
    released_as: customerSafeDetailForBusinessItem(item),
  };
}

function businessQueueItemsFromRequest(request: string): Array<{
  request: string;
  category: string;
  status: string;
  risk: string;
  nextStep: string;
}> {
  const items = splitBusinessItems(request);
  const sourceItems = items.length > 0 ? items : [request];
  return sourceItems.map((item) => ({
    request: sentenceCase(item),
    category: categoryForBusinessItem(item),
    status: statusForBusinessItem(item),
    risk: riskForBusinessItem(item),
    nextStep: nextStepForBusinessItem(item),
  }));
}

function operationsQueueSourceData(
  input: GovernedActionInput,
  items: Array<{
    request: string;
    category: string;
    status: string;
    risk: string;
    nextStep: string;
  }>,
): JsonRecord {
  return {
    requestContext: {
      action: input.action,
      request: input.request,
      destination: input.destination,
      audience: input.audience,
      sensitivity: input.sensitivity,
    },
    queueItems: items,
  };
}

function splitBusinessItems(request: string): string[] {
  const afterColon = request.includes(":")
    ? request.slice(request.indexOf(":") + 1)
    : request;
  return afterColon
    .replace(/\band\b/gi, ",")
    .split(/[;\n,]/)
    .map((item) => cleanBusinessItem(item))
    .filter((item) => item.length > 0);
}

function cleanBusinessItem(item: string): string {
  return item
    .replace(
      /^\s*(review|prepare|draft|using|from|these notes|this internal context)\b[:\s-]*/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
}

function titleFromBusinessItem(item: string): string {
  const words = cleanBusinessItem(item).split(/\s+/).slice(0, 6);
  return sentenceCase(words.join(" "));
}

function categoryForBusinessItem(item: string): string {
  const text = item.toLowerCase();
  if (/\binvoice|billing|payment|credit|po\b/.test(text))
    return "Finance operations";
  if (/\bdashboard|service|refresh|support|ticket\b/.test(text))
    return "Customer operations";
  if (/\bvendor|handoff|review\b/.test(text)) return "Vendor operations";
  return "Operations";
}

function statusForBusinessItem(item: string): string {
  const text = item.toLowerCase();
  if (
    /\bmissing|failed|delay|escalation|review|bank|payment batch\b/.test(text)
  ) {
    return "needs_review";
  }
  return "ready";
}

function riskForBusinessItem(item: string): string {
  const text = item.toLowerCase();
  if (/\bbank|payment batch|personal gmail|external\b/.test(text))
    return "High";
  if (/\$\d|acct_|@|phone|failed|missing|escalation/.test(text))
    return "Medium";
  return "Low";
}

function impactForBusinessItem(item: string): string {
  const text = item.toLowerCase();
  if (/\binvoice|payment|credit|po\b/.test(text)) return "Finance follow-up";
  if (/\bdashboard|service|support\b/.test(text))
    return "Customer communication";
  if (/\bvendor|handoff|review\b/.test(text)) return "Vendor coordination";
  return "Operational follow-up";
}

function nextStepForBusinessItem(item: string): string {
  const text = item.toLowerCase();
  if (/\bmissing|failed|delay|escalation|review\b/.test(text)) {
    return "Confirm owner and prepare the next safe update.";
  }
  if (/\bschedule|call\b/.test(text)) {
    return "Schedule the review and note the owner.";
  }
  if (/\bclose\b/.test(text)) {
    return "Close after confirming duplicate status.";
  }
  if (/\bresend\b/.test(text)) {
    return "Proceed with the standard resend path.";
  }
  return "Prepare the next action for review.";
}

function serviceTierForBusinessItem(item: string): string {
  return /\bcritical|production|payment|failed|delay\b/i.test(item)
    ? "Business-critical"
    : "Standard";
}

function timelineForBusinessItem(item: string): string {
  return /\bfailed|delay|escalation\b/i.test(item)
    ? "Current review cycle"
    : "Next business cycle";
}

function ownerNoteForBusinessItem(item: string): string {
  const category = categoryForBusinessItem(item);
  return `${category} owner should confirm the next action before release.`;
}

function customerSafeDetailForBusinessItem(item: string): string {
  return sentenceCase(
    item
      .replace(/\bacct_[a-z0-9_]+\b/gi, "the account")
      .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "the customer contact")
      .replace(/\+1\s\d{3}\s555\s\d{4}\b/g, "the contact phone")
      .replace(/\$\d[\d,]*(?:\.\d{2})?\b/g, "the payment amount"),
  );
}

function releaseCheckFromText(text: string): BusinessEvidence["releaseCheck"] {
  return sensitiveValuesFromText(text).map((value) => ({
    found: sourceLabelForSensitiveValue(value),
    sourceValue: value,
    releasedAs: releasedAsForSensitiveValue(value),
  }));
}

function sensitiveValuesFromText(text: string): string[] {
  return Array.from(
    new Set([
      ...(text.match(/\bacct_[a-z0-9_]+\b/gi) ?? []),
      ...(text.match(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g) ?? []),
      ...(text.match(/\+1\s\d{3}\s555\s\d{4}\b/g) ?? []),
      ...(text.match(/\$\d[\d,]*(?:\.\d{2})?\b/g) ?? []),
    ]),
  );
}

function sourceLabelForSensitiveValue(value: string): string {
  if (/^acct_/i.test(value)) return "Account identifier";
  if (value.includes("@")) return "Direct contact email";
  if (value.startsWith("+1")) return "Direct phone number";
  if (value.startsWith("$")) return "Payment amount";
  return "Sensitive source value";
}

function releasedAsForSensitiveValue(value: string): string {
  if (/^acct_/i.test(value)) return "customer account";
  if (value.includes("@")) return "customer contact";
  if (value.startsWith("+1")) return "contact availability";
  if (value.startsWith("$")) return "payment context";
  return "safe business context";
}

function envValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`${name} is required for this OpenBox demo flow.`);
  return value;
}

function coerceString(value: unknown, defaultValue: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : defaultValue;
}

function spanProfile(
  input: GovernedActionInput,
): Pick<SpanData, "name" | "kind" | "attributes"> {
  if (input.action === "view_governance_report") {
    return {
      name: "openbox.governance_report.read",
      kind: "client",
      attributes: {
        "openbox.operation": "read_governance_report",
        "openbox.agent_id": envValue("OPENBOX_AGENT_ID"),
      },
    };
  }

  if (input.action === "review_data_handoff") {
    return businessSpan("openbox.vendor_review.prepare_handoff", {
      "openbox.operation": "prepare_vendor_review_handoff",
      "openbox.destination": coerceString(
        input.destination,
        "External review workspace",
      ),
    });
  }

  if (input.action === "export_governance_identifiers") {
    return businessSpan("openbox.governance_identifiers.export_request", {
      "openbox.operation": "request_governance_identifier_export",
      "openbox.destination": coerceString(
        input.destination,
        "external destination",
      ),
    });
  }

  if (input.action === "issue_large_refund") {
    return businessSpan("openbox.credit_memo.review", {
      "openbox.operation": "review_credit_memo",
      "openbox.amount_usd": input.amountUsd,
    });
  }

  if (input.action === "disable_production_payments") {
    return businessSpan("openbox.vendor_payment_change.review", {
      "openbox.operation": "review_vendor_payment_change",
      "openbox.sensitivity": "restricted",
    });
  }

  if (input.action === "open_operations_queue") {
    return {
      name: "openbox.governed_operations_queue.read",
      kind: "client",
      attributes: {
        "openbox.operation": "read_governed_operations_queue",
        "openbox.agent_id": envValue("OPENBOX_AGENT_ID"),
      },
    };
  }

  return {
    name: `internal.${input.action}`,
    kind: "internal",
    attributes: {
      "openbox.span.category": "internal_workflow",
    },
  };
}

function businessSpan(
  name: string,
  attributes: Record<string, unknown>,
): Pick<SpanData, "name" | "kind" | "attributes"> {
  return {
    name,
    kind: "client",
    attributes,
  };
}

function stableReference(prefix: string, seed: string): string {
  const digest = randomBytes(2).toString("hex").toUpperCase();
  const hint = seed
    .replace(/[^a-z0-9]+/gi, "")
    .slice(0, 4)
    .toUpperCase()
    .padEnd(4, "X");
  return `${prefix}-${hint}-${digest}`;
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

function startTiming(label: string) {
  const startedAt = Date.now();
  console.info(`[openbox-governed-copilotkit] ${label} started`);
  return {
    done<T>(value: T): T {
      console.info(
        `[openbox-governed-copilotkit] ${label} finished in ${Date.now() - startedAt}ms`,
      );
      return value;
    },
  };
}
