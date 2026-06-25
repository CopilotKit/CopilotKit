import { useConfigureSuggestions } from "@copilotkit/react-core/v2";
const openboxWorkflowSuggestions = [
  {
    title: "Review Work Queue",
    message:
      "Review this operations queue and tell me what can move forward: resend a customer invoice, follow up on a dashboard refresh delay, close a duplicate support ticket, and schedule a vendor review call.",
    className: "openbox-governed-suggestion openbox-workflow-suggestion",
  },
  {
    title: "Prepare Exception Report",
    message:
      "Prepare a finance exception report from these notes: acct_24819 has a failed $12,400 payment retry, invoice INV-1048 is missing a PO, and riley.morgan@example.com asked for escalation at +1 415 555 0198.",
    className: "openbox-governed-suggestion openbox-workflow-suggestion",
  },
  {
    title: "Draft Customer Update",
    message:
      "Draft a short customer update about the dashboard refresh delay using this internal context: acct_24819, riley.morgan@example.com, +1 415 555 0198, and a recent $12,400 payment retry.",
    className: "openbox-governed-suggestion openbox-workflow-suggestion",
  },
  {
    title: "Prepare Vendor Handoff",
    message:
      "Prepare a vendor review handoff for the external workspace using these notes: dashboard refresh delay affects the business-critical queue, current review cycle timing, and the operations owner should share only minimum context.",
    className: "openbox-governed-suggestion openbox-workflow-suggestion",
  },
  {
    title: "Draft Billing Escalation",
    message:
      "Draft a billing escalation note for a failed invoice resend and let me edit it before sending.",
    className: "openbox-governed-suggestion openbox-workflow-suggestion",
  },
  {
    title: "Issue Service Credit",
    message:
      "Issue a $7,500 service credit for the approved customer account and process the credit memo.",
    className: "openbox-governed-suggestion openbox-workflow-suggestion",
  },
  {
    title: "Send Exception IDs",
    message:
      "Send the payment exception IDs to my personal Gmail so I can review them tonight.",
    className: "openbox-governed-suggestion openbox-workflow-suggestion",
  },
  {
    title: "Update Vendor Bank",
    message:
      "Update the vendor bank details and release the production payment batch.",
    className: "openbox-governed-suggestion openbox-workflow-suggestion",
  },
];

export const useExampleSuggestions = () => {
  useConfigureSuggestions({
    suggestions: openboxWorkflowSuggestions,
    available: "always",
  });
};
