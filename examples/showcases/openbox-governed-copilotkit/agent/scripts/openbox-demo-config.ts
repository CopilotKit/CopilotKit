export const DEMO_PREFIX = "copilotkit-demo/";
export const DEMO_POLICY_MARKER =
  "copilotkit-demo/openbox-governance-matrix-v4";
export const DEMO_BEHAVIOR_RULE_NAME = `${DEMO_PREFIX}llm-tool-call-governance-observed`;
const GOVERNED_TOOL_ACTIVITY_TYPE = "openbox_governed_action";

const toolEndFields = [
  "output.artifact.title",
  "output.artifact.summary",
  "output.artifact.body",
  "output.artifact.memo",
  "output.artifact.message",
  "output.artifact.nextStep",
  "output.artifact.ledgerImpact",
  "output.artifact.items.*.request",
  "output.artifact.items.*.label",
  "output.artifact.items.*.title",
  "output.artifact.items.*.summary",
  "output.artifact.items.*.body",
  "output.artifact.items.*.issue",
  "output.artifact.items.*.impact",
  "output.artifact.items.*.nextStep",
  "output.artifact.items.*.next_step",
  "output.artifact.records.*.item",
  "output.artifact.records.*.issue",
  "output.artifact.records.*.impact",
  "output.artifact.records.*.next_step",
  "output.artifact.records.*.summary",
  "output.artifact.records.*.customer_safe_detail",
  "output.artifact.records.*.internal_context",
  "output.artifact.sourceContext",
  "output.artifact.records.*.source_id",
  "output.artifact.records.*.agent_id",
  "output.artifact.records.*.session_id",
  "output.artifact.releaseCheck.*.sourceValue",
  "output.summary",
  "output.body",
];

const toolRequestFields = ["input.0.args.request", "input.args.request"];

const toolEndStringFields = [
  "output.artifact.title",
  "output.artifact.summary",
  "output.artifact.report.*.item",
  "output.artifact.report.*.issue",
  "output.artifact.report.*.impact",
  "output.artifact.report.*.next_step",
  "output.artifact.items.*.request",
  "output.artifact.items.*.label",
  "output.artifact.items.*.title",
  "output.artifact.items.*.summary",
  "output.artifact.items.*.body",
  "output.artifact.items.*.issue",
  "output.artifact.items.*.impact",
  "output.artifact.items.*.nextStep",
  "output.artifact.items.*.next_step",
  "output.artifact.records.*.item",
  "output.artifact.records.*.issue",
  "output.artifact.records.*.impact",
  "output.artifact.records.*.next_step",
  "output.artifact.records.*.summary",
  "output.artifact.records.*.customer_safe_detail",
  "output.artifact.records.*.internal_context",
  "output.artifact.recommended_focus.*",
  "output.artifact.body",
  "output.artifact.memo",
  "output.artifact.message",
  "output.artifact.nextStep",
  "output.artifact.ledgerImpact",
  "output.artifact.sourceContext",
  "output.artifact.records.*.source_id",
  "output.artifact.records.*.agent_id",
  "output.artifact.records.*.session_id",
  "output.artifact.releaseCheck.*.sourceValue",
  "output.summary",
  "output.body",
];

function toolGuardrailSettings(fields: string[], onFail: 0 | 1) {
  return {
    on_fail: onFail,
    log_violation: true,
    activities: [
      {
        activity_type: GOVERNED_TOOL_ACTIVITY_TYPE,
        fields_to_check: fields,
      },
    ],
    timeout: 5000,
    retry_attempts: 2,
  };
}

export const demoGoalAlignmentConfig = {
  alignment_threshold: 70,
  llama_firewall_model: "gpt-4o-mini",
  drift_detection_action: "alert_only",
  evaluation_frequency: "every_action",
} as const;

export type DemoGuardrail = {
  name: string;
  description: string;
  guardrail_type: string;
  processing_stage: string;
  params: Record<string, unknown>;
  settings: Record<string, unknown>;
  trust_impact: string;
};

export type DemoBehaviorRule = {
  rule_name: string;
  description: string;
  priority: number;
  trigger: string;
  states: string[];
  time_window: number;
  verdict: number;
  approval_timeout?: number;
  reject_message: string;
  trust_impact: string;
  trust_threshold: number;
};

export const demoGuardrails: DemoGuardrail[] = [
  {
    name: `${DEMO_PREFIX}pii-input-redaction`,
    description:
      "Redact PII from CopilotKit governed tool input before business execution.",
    guardrail_type: "1",
    processing_stage: "0",
    // Exclude DATE_TIME so ordinary scheduling text is not redacted.
    params: {
      entities: [
        "EMAIL_ADDRESS",
        "PHONE_NUMBER",
        "IP_ADDRESS",
        "US_PASSPORT",
        "US_DRIVER_LICENSE",
      ],
      replace_values: [],
    },
    settings: toolGuardrailSettings(toolRequestFields, 0),
    trust_impact: "low",
  },
  {
    name: `${DEMO_PREFIX}business-identifier-input-redaction`,
    description:
      "Redact demo business account and payment identifiers from CopilotKit governed tool input.",
    guardrail_type: "4",
    processing_stage: "0",
    params: {
      banned_words: [
        "account identifier",
        "customer contact",
        "phone number",
        "payment amount",
        "acct_9281",
        "acct_24819",
        "acct_",
        "$14,400",
        "14,400",
        "$12,400",
        "12,400",
      ],
      max_l_dist: 1,
    },
    settings: toolGuardrailSettings(toolRequestFields, 0),
    trust_impact: "low",
  },
  {
    name: `${DEMO_PREFIX}pii-output-redaction`,
    description:
      "Redact PII from CopilotKit governed tool output before UI rendering.",
    guardrail_type: "1",
    processing_stage: "1",
    params: {
      entities: [
        "EMAIL_ADDRESS",
        "PHONE_NUMBER",
        "IP_ADDRESS",
        "US_PASSPORT",
        "US_DRIVER_LICENSE",
      ],
      replace_values: [],
    },
    settings: toolGuardrailSettings(toolEndFields, 0),
    trust_impact: "low",
  },
  {
    name: `${DEMO_PREFIX}banlist-input-data-egress-block`,
    description:
      "Block restricted egress phrases before governed business execution.",
    guardrail_type: "4",
    processing_stage: "0",
    params: {
      banned_words: [
        "personal gmail",
        "production admin token",
        "admin token",
        "session export",
        "control export",
        "unapproved spreadsheet",
      ],
      max_l_dist: 1,
    },
    settings: toolGuardrailSettings(toolRequestFields, 1),
    trust_impact: "medium",
  },
  {
    name: `${DEMO_PREFIX}banlist-output-source-context-redaction`,
    description:
      "Keep source-context labels out of released output when a ban-list validator is active.",
    guardrail_type: "4",
    processing_stage: "1",
    params: {
      banned_words: [
        "account identifier",
        "customer contact",
        "phone number",
        "payment amount",
        "acct_9281",
        "acct_24819",
        "acct_",
        "$14,400",
        "14,400",
        "$12,400",
        "12,400",
        "agent_id",
        "session_id",
        "workflow_id",
        "policy_id",
        "source_id",
      ],
      max_l_dist: 1,
    },
    settings: toolGuardrailSettings(toolEndStringFields, 0),
    trust_impact: "low",
  },
  {
    name: `${DEMO_PREFIX}toxicity-input-monitor`,
    description: "Monitor hostile or toxic input on governed tool requests.",
    guardrail_type: "3",
    processing_stage: "0",
    params: {
      threshold: 0.98,
      validation_method: "sentence",
    },
    settings: toolGuardrailSettings(toolRequestFields, 1),
    trust_impact: "low",
  },
  {
    name: `${DEMO_PREFIX}nsfw-input-monitor`,
    description: "Monitor NSFW input on governed tool requests.",
    guardrail_type: "2",
    processing_stage: "0",
    params: {
      threshold: 0.7,
      validation_method: "sentence",
    },
    settings: toolGuardrailSettings(toolRequestFields, 0),
    trust_impact: "low",
  },
];

export const obsoleteDemoGuardrailNames = [
  "Local CopilotKit governance report PII redaction",
  `${DEMO_PREFIX}sensitive-crm-export-block`,
  `${DEMO_PREFIX}restricted-manual-submission-block`,
  `${DEMO_PREFIX}regex-input-restricted-export-block`,
  `${DEMO_PREFIX}regex-output-sensitive-source-redaction`,
];

export const demoBehaviorRules: DemoBehaviorRule[] = [
  {
    rule_name: DEMO_BEHAVIOR_RULE_NAME,
    description:
      "Observe CopilotKit tool calls so behavior governance is present and auditable for the OpenBox demo.",
    priority: 50,
    trigger: "llm_tool_call",
    states: ["llm_tool_call"],
    time_window: 300,
    verdict: 0,
    reject_message:
      "OpenBox observed this CopilotKit tool call under the demo behavior rule.",
    trust_impact: "low",
    trust_threshold: 10,
  },
  {
    rule_name: `${DEMO_PREFIX}llm-completion-final-output-governance`,
    description:
      "Require final model output to stay under OpenBox runtime output governance.",
    priority: 60,
    trigger: "llm_completion",
    states: ["llm_completion"],
    time_window: 300,
    verdict: 1,
    reject_message: "OpenBox constrained final model output before release.",
    trust_impact: "medium",
    trust_threshold: 25,
  },
  {
    rule_name: `${DEMO_PREFIX}http-post-egress-approval`,
    description:
      "Require approval before HTTP POST egress to external business systems.",
    priority: 70,
    trigger: "http_post",
    states: ["http_post"],
    time_window: 300,
    verdict: 2,
    approval_timeout: 300,
    reject_message: "OpenBox requires approval before external POST egress.",
    trust_impact: "medium",
    trust_threshold: 30,
  },
  {
    rule_name: `${DEMO_PREFIX}database-write-block`,
    description:
      "Block direct database write semantics in this governed demo agent.",
    priority: 80,
    trigger: "database_update",
    states: ["database_update"],
    time_window: 300,
    verdict: 3,
    reject_message:
      "OpenBox blocks database write operations for this demo agent.",
    trust_impact: "high",
    trust_threshold: 50,
  },
  {
    rule_name: `${DEMO_PREFIX}file-export-halt`,
    description:
      "Halt file-export semantics that could persist restricted OpenBox evidence outside approved systems.",
    priority: 90,
    trigger: "file_write",
    states: ["file_write"],
    time_window: 300,
    verdict: 4,
    reject_message: "OpenBox halted this file export path.",
    trust_impact: "high",
    trust_threshold: 60,
  },
  {
    rule_name: `${DEMO_PREFIX}internal-runtime-observed`,
    description: "Observe internal runtime operations for audit continuity.",
    priority: 40,
    trigger: "internal",
    states: ["internal"],
    time_window: 300,
    verdict: 0,
    reject_message: "OpenBox observed this internal runtime operation.",
    trust_impact: "low",
    trust_threshold: 5,
  },
];

export const demoBehaviorStates = demoBehaviorRules.map((rule) => rule.trigger);

export const demoPolicyRules = `# ${DEMO_POLICY_MARKER}

default result = {"decision": "ALLOW", "action": "allow", "reason": null}

started if {
  input.event_type == "ActivityStarted"
}

tool_args := args if {
  args := input.activity_input[0].args
}

tool_args := args if {
  args := input.activity_input.args
}

governed_action := action if {
  action := tool_args.action
}

request_text := text if {
  text := lower(sprintf("%v %v %v %v %v", [
    tool_args.request,
    tool_args.destination,
    tool_args.manualInput,
    tool_args.choiceId,
    tool_args.fields,
  ]))
}

is_operations_queue_review if {
  governed_action == "open_operations_queue"
}

result := {"decision": "ALLOW", "action": "allow", "reason": "OpenBox allowed this governed operations queue review."} if {
  started
  is_operations_queue_review
}

result := {"decision": "BLOCK", "action": "block", "reason": "OpenBox blocked goal drift from governed work into an unrelated personal internal-identifier export."} if {
  started
  governed_action == "export_governance_identifiers"
}

result := {"decision": "BLOCK", "action": "block", "reason": "OpenBox blocked internal identifier export to a personal or external destination."} if {
  started
  contains(request_text, "personal gmail")
  contains(request_text, "identifier")
}

result := {"decision": "REQUIRE_APPROVAL", "action": "require_approval", "reason": "OpenBox requires explicit human approval before issuing this credit memo or refund."} if {
  started
  governed_action == "issue_large_refund"
}

result := {"decision": "HALT", "action": "halt", "reason": "OpenBox halted this payment-control change because vendor bank-account changes and payment batch release are critical production actions."} if {
  started
  governed_action == "disable_production_payments"
}

handoff_choice := choice if {
  governed_action == "review_data_handoff"
  choice := lower(sprintf("%v", [tool_args.choiceId]))
}

result := {"decision": "BLOCK", "action": "block", "reason": "OpenBox blocked this external handoff because it includes direct OpenBox identifiers for an external destination."} if {
  started
  handoff_choice == "sensitive"
}

result := {"decision": "ALLOW", "action": "allow", "reason": "OpenBox allowed this minimized external evidence package."} if {
  started
  governed_action == "review_data_handoff"
  handoff_choice == "minimal"
}

manual_payload := text if {
  governed_action == "submit_manual_request"
  text := lower(sprintf("%v %v", [tool_args.manualInput, tool_args.destination]))
}

manual_restricted if contains(manual_payload, "personal gmail")
manual_restricted if contains(manual_payload, "admin token")
manual_restricted if contains(manual_payload, "production token")
manual_restricted if contains(manual_payload, "session export")
manual_restricted if contains(manual_payload, "control export")

result := {"decision": "BLOCK", "action": "block", "reason": "OpenBox blocked this human-edited draft because it requests restricted data outside approved systems."} if {
  started
  manual_restricted
}

result := {"decision": "ALLOW", "action": "allow", "reason": "OpenBox allowed this customer update after output guardrails review."} if {
  started
  governed_action == "draft_policy_constrained_message"
}

result := {"decision": "ALLOW", "action": "allow", "reason": "OpenBox allowed this operations exception report subject to guardrail redaction."} if {
  started
  governed_action == "view_governance_report"
}`;
