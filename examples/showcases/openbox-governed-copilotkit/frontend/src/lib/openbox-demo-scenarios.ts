export const openBoxDemoScenarios = [
  {
    action: "copilotkit_runtime_gate",
    title: "Request Review",
    reason: "OpenBox is reviewing the request before the assistant continues.",
    capability: "Runtime governance, audit trail",
    verdict: "allow",
  },
  {
    action: "open_operations_queue",
    title: "Operations Queue",
    reason: "OpenBox allowed this work-queue review.",
    capability: "Runtime policy, guardrails, behavior rules, audit trail",
    verdict: "allow",
  },
  {
    action: "view_governance_report",
    title: "Exception Report",
    reason:
      "OpenBox allowed this operations exception report subject to output redaction.",
    capability: "Output guardrails, redaction, audit trail",
    verdict: "constrain",
  },
  {
    action: "draft_policy_constrained_message",
    title: "Customer Update Draft",
    reason:
      "OpenBox checks the generated draft before it is released to a customer channel.",
    capability: "Final output governance, guardrails, redaction",
    verdict: "constrain",
  },
  {
    action: "review_data_handoff",
    title: "Vendor Review Handoff",
    reason:
      "OpenBox checks destination and field selection before preparing the handoff.",
    capability: "Data minimization, destination policy, redaction",
    verdict: "constrain",
  },
  {
    action: "submit_manual_request",
    title: "Manual Escalation Draft",
    reason: "OpenBox evaluates the final human-edited note before execution.",
    capability: "Manual input governance, guardrails",
    verdict: "allow",
  },
  {
    action: "create_support_ticket",
    title: "Support Ticket",
    reason: "OpenBox allowed this internal support action.",
    capability: "Internal workflow policy",
    verdict: "allow",
  },
  {
    action: "send_public_status_update",
    title: "Public Status Update",
    reason: "OpenBox allowed this low-sensitivity communication.",
    capability: "Public-content policy",
    verdict: "allow",
  },
  {
    action: "export_governance_identifiers",
    title: "Send Exception IDs",
    reason:
      "OpenBox blocked drift from governed work into a personal internal-identifier export.",
    capability: "Goal drift, destination policy",
    verdict: "block",
  },
  {
    action: "issue_large_refund",
    title: "Service Credit Approval",
    reason: "OpenBox requires human approval before issuing this credit memo.",
    capability: "Human-in-the-loop approval",
    verdict: "approval",
  },
  {
    action: "disable_production_payments",
    title: "Vendor Bank Update",
    reason: "OpenBox halted a critical production payment-control change.",
    capability: "Critical action halt",
    verdict: "halt",
  },
] as const;
