import type {
  InspectorLearningInsight,
  InspectorLearningSnapshotV1,
  RuntimeInfo,
} from "@copilotkit/shared";

export const APPROVED_LEARNING_STATES = [
  "no-threads",
  "threads-available",
  "success",
  "insights-only",
  "multiple-skills",
  "new-threads",
  "empty-results",
  "setup-error",
] as const;

export const LEARNING_LAB_BASE_PATH = "/inspector-learning-lab";

export const BEHAVIOR_LEARNING_STATES = [
  "landing",
  "setup-pending",
  "loading",
  "data-error",
  "selection-required",
  "first-run",
  "candidates-only",
] as const;

export type LearningScreenshotState =
  | (typeof APPROVED_LEARNING_STATES)[number]
  | (typeof BEHAVIOR_LEARNING_STATES)[number];

export type LearningWorkbenchScenarioKey =
  `learning-${LearningScreenshotState}`;

/** Ordered state catalog shared by the root workbench and browser harness. */
export const LEARNING_WORKBENCH_SCENARIOS = [
  { state: "landing", key: "learning-landing", label: "Landing" },
  {
    state: "setup-pending",
    key: "learning-setup-pending",
    label: "Waiting · setup completion",
  },
  {
    state: "no-threads",
    key: "learning-no-threads",
    label: "Waiting · no Threads",
  },
  {
    state: "threads-available",
    key: "learning-threads-available",
    label: "Threads ready",
  },
  { state: "first-run", key: "learning-first-run", label: "First run" },
  {
    state: "success",
    key: "learning-success",
    label: "Skills and Insights",
  },
  {
    state: "insights-only",
    key: "learning-insights-only",
    label: "Insights only",
  },
  {
    state: "multiple-skills",
    key: "learning-multiple-skills",
    label: "Multiple Skills",
  },
  {
    state: "new-threads",
    key: "learning-new-threads",
    label: "New Threads · retained results",
  },
  {
    state: "candidates-only",
    key: "learning-candidates-only",
    label: "Candidates only",
  },
  {
    state: "empty-results",
    key: "learning-empty-results",
    label: "Empty results",
  },
  {
    state: "setup-error",
    key: "learning-setup-error",
    label: "Setup error",
  },
  { state: "loading", key: "learning-loading", label: "Loading" },
  { state: "data-error", key: "learning-data-error", label: "Data error" },
  {
    state: "selection-required",
    key: "learning-selection-required",
    label: "Selection required",
  },
] as const satisfies readonly Readonly<{
  state: LearningScreenshotState;
  key: LearningWorkbenchScenarioKey;
  label: string;
}>[];

export const LEARNING_SCREENSHOT_STATES: readonly LearningScreenshotState[] =
  LEARNING_WORKBENCH_SCENARIOS.map(({ state }) => state);

export type LearningLabState = LearningScreenshotState | "pagination";

export function learningRuntimeInfo(state: LearningLabState): RuntimeInfo {
  return {
    mode: "intelligence",
    version: "inspector-learning-v5-lab",
    agents: {
      "Checkout Assistant": {
        name: "Checkout Assistant",
        className: "HttpAgent",
        description: "Checkout Assistant",
      },
    },
    audioFileTranscriptionEnabled: false,
    suggestions: false,
    a2uiEnabled: false,
    openGenerativeUIEnabled: false,
    telemetryDisabled: true,
    ...(state !== "landing"
      ? { intelligence: { wsUrl: "ws://127.0.0.1:5177/intelligence-lab" } }
      : {}),
    ...(state === "setup-pending" ? {} : { inspectorLearning: true }),
  };
}

const WEB_APP_ORIGIN = "https://app.copilotkit.ai";
const configured = {
  state: "configured" as const,
  container: {
    id: "checkout-assistant-default",
    name: "Checkout Assistant",
  },
};

const evidence = (
  threadId: string,
  threadName: string | null,
  messageId: string,
) => ({
  status: "available" as const,
  threadId,
  threadName,
  messageIds: [messageId],
  updatedAt: "2026-09-03T18:00:00.000Z",
});

const insights: readonly InspectorLearningInsight[] = [
  {
    id: "refund",
    statement:
      "Verify the order before giving refund guidance. In the supporting Threads, customers had to correct the assistant after it discussed refund eligibility without reading the order or payment state.",
    impact:
      "Future refund responses should first retrieve the order, confirm which charge settled, and only then explain eligibility and timing. If the order cannot be found, ask for the checkout email instead of guessing.",
    totalThreadCount: 12,
    evidenceTruncated: false,
    evidence: [
      evidence("thread-1842", "Duplicate charge · #1842", "message-1842"),
      evidence("thread-1764", "Refund status · #1764", "message-1764"),
      evidence("thread-1691", "Wrong item received · #1691", "message-1691"),
    ],
  },
  {
    id: "next-step",
    statement:
      "Lead policy answers with the action the customer can take. Customers repeatedly asked what to do next after receiving a correct return or exchange policy.",
    impact:
      "Future policy responses should state the next action and any deadline before the supporting details. Ask a follow-up question only when the required order or product information is missing.",
    totalThreadCount: 7,
    evidenceTruncated: false,
    evidence: [
      evidence("thread-1798", "Return window · #1798", "message-1798"),
      evidence("thread-1750", "Exchange request · #1750", "message-1750"),
      evidence("thread-1707", "Shipping delay · #1707", "message-1707"),
    ],
  },
  {
    id: "delivery-address",
    statement:
      "Confirm the delivery address before replacing a missing shipment. Several Threads contained replacement offers before the assistant checked where the order was sent.",
    impact:
      "Future replacement responses must retrieve the saved address and carrier scan first. If the address is wrong, explain the correction path before promising another shipment.",
    totalThreadCount: 9,
    evidenceTruncated: false,
    evidence: [
      evidence("thread-1688", "Missing package · #1688", "message-1688"),
    ],
  },
  {
    id: "payment-state",
    statement:
      "Separate pending authorizations from settled duplicate charges. Customers received refund promises for charges that were still pending.",
    impact:
      "Future payment responses must name the state of each charge. A pending authorization needs an expiration estimate, not a refund workflow.",
    totalThreadCount: 6,
    evidenceTruncated: false,
    evidence: [
      evidence("thread-1589", "Pending charge · #1589", "message-1589"),
    ],
  },
  {
    id: "return-deadline",
    statement:
      "Calculate the return deadline from the delivery date. Customers received generic policy text when the assistant had enough order data to give an exact date.",
    impact:
      "Future return responses must state the final eligible date first. Then list any condition that can make the item ineligible.",
    totalThreadCount: 8,
    evidenceTruncated: false,
    evidence: [evidence("thread-1497", "Return date · #1497", "message-1497")],
  },
  {
    id: "tracking-escalation",
    statement:
      "Escalate stalled shipments after the carrier deadline passes. Customers repeated the same question after the assistant restated stale tracking details.",
    impact:
      "Future shipping responses must compare the last scan with the carrier window. If the last scan is too old, open the escalation path.",
    totalThreadCount: 5,
    evidenceTruncated: false,
    evidence: [
      evidence("thread-1390", "Tracking stalled · #1390", "message-1390"),
    ],
  },
  {
    id: "damaged-item",
    statement:
      "Ask which item is damaged before offering an exchange. Multi-item orders caused the assistant to apply an exchange to the wrong product.",
    impact:
      "Future exchange responses must identify the item and quantity first. Then explain the replacement options for that product.",
    totalThreadCount: 6,
    evidenceTruncated: false,
    evidence: [evidence("thread-1294", "Damaged item · #1294", "message-1294")],
  },
  {
    id: "refund-timing",
    statement:
      "Name the bank-processing window after a refund is issued. Customers reopened Threads because the assistant only said the refund was complete.",
    impact:
      "Future refund-status responses must include the issue date and expected bank window. If that window has passed, provide the escalation step.",
    totalThreadCount: 4,
    evidenceTruncated: false,
    evidence: [
      evidence("thread-1196", "Refund pending · #1196", "message-1196"),
    ],
  },
];

const skills = [
  {
    id: "skill-refund",
    name: "verify-refund-request",
    description:
      "Use when a customer requests a refund or reports a duplicate charge. Do not use for billing questions without an order.",
    revision: 3,
    skillMd: `---
name: verify-refund-request
description: Use when a customer requests a refund or reports a duplicate charge. Do not use for billing questions without an order.
---

# Verify a Refund Request

## Instructions

1. Ask for the exact order ID and the email address used at checkout.
2. Retrieve the order and verify the payment state before discussing refund eligibility.
3. For a duplicate charge, distinguish a settled payment from a pending authorization.
4. Explain the result, expected timing, and the next action available to the customer.`,
    sourceInsight: insights[0]!,
  },
  {
    id: "skill-next-step",
    name: "lead-with-policy-next-step",
    description:
      "Use when a customer needs help applying a support policy. Do not use for requests that only ask for the policy text.",
    revision: 2,
    skillMd: `---
name: lead-with-policy-next-step
description: Use when a customer needs help applying a support policy.
---

# Lead with the Next Step

1. Identify the action the customer can take.
2. State that action and any deadline before the policy details.
3. End with the next step the customer or support agent must take.`,
    sourceInsight: insights[1]!,
  },
  {
    id: "skill-address",
    name: "confirm-delivery-address",
    description:
      "Use when a customer reports a missing delivery or requests a replacement. Do not use until the order and address are available.",
    revision: 1,
    skillMd:
      "# Confirm the Delivery Address\n\nRetrieve the order, saved address, and latest carrier scan before offering a replacement.",
    sourceInsight: insights[2]!,
  },
  {
    id: "skill-payment",
    name: "explain-payment-state",
    description:
      "Use when a customer reports a duplicate or pending charge. Do not use for a refund that is already complete.",
    revision: 1,
    skillMd:
      "# Explain the Payment State\n\nName each charge as pending, settled, refunded, or failed.",
    sourceInsight: insights[3]!,
  },
  {
    id: "skill-return",
    name: "calculate-return-deadline",
    description:
      "Use when a customer asks whether an item can be returned. Do not use without the delivery date and product policy.",
    revision: 1,
    skillMd:
      "# Calculate the Return Deadline\n\nCalculate and state the final eligible return date.",
    sourceInsight: insights[4]!,
  },
  {
    id: "skill-shipment",
    name: "escalate-stalled-shipment",
    description:
      "Use when shipment tracking remains unchanged past the carrier deadline. Do not use while the expected delivery window is open.",
    revision: 1,
    skillMd:
      "# Escalate a Stalled Shipment\n\nCompare the last carrier scan with the promised delivery window.",
    sourceInsight: insights[5]!,
  },
] as const;

function page<T>(items: readonly T[], pageSize: 3 | 4, requested = 1) {
  if (items.length === 0) {
    return { page: 1, pageSize, total: 0, totalPages: 0, items: [] };
  }
  const totalPages = Math.ceil(items.length / pageSize);
  const current = Math.min(Math.max(requested, 1), totalPages);
  const start = (current - 1) * pageSize;
  return {
    page: current,
    pageSize,
    total: items.length,
    totalPages,
    items: items.slice(start, start + pageSize),
  };
}

function links(container = false) {
  const learning = container
    ? `${WEB_APP_ORIGIN}/learning?container=checkout-assistant-default`
    : `${WEB_APP_ORIGIN}/learning`;
  return {
    learning,
    candidates: container
      ? `${WEB_APP_ORIGIN}/o/acme/checkout/learning/checkout-assistant-default/skills`
      : null,
    runs: container ? `${learning}&tab=runs` : null,
  };
}

function base(
  overrides: Partial<InspectorLearningSnapshotV1>,
): InspectorLearningSnapshotV1 {
  return {
    schemaVersion: 1,
    projectKey: "checkout-assistant-project",
    snapshotVersion: "learning-state-fixture-v5",
    webAppOrigin: WEB_APP_ORIGIN,
    configuration: { state: "not_configured" },
    pendingThreadCount: 0,
    run: { hasActiveRun: false, hasEverSucceeded: false, latest: null },
    pendingCandidateCount: 0,
    skillsPage: page([], 3),
    insightsPage: page([], 4),
    links: links(false),
    ...overrides,
  };
}

export function learningSnapshotForState(
  state: LearningLabState,
  requested: Readonly<{ skillsPage?: number; insightsPage?: number }> = {},
): InspectorLearningSnapshotV1 {
  if (state === "pagination") {
    return base({
      configuration: configured,
      pendingCandidateCount: 2,
      run: {
        hasActiveRun: false,
        hasEverSucceeded: true,
        latest: {
          status: "succeeded",
          completedAt: "2026-09-03T18:30:00.000Z",
        },
      },
      skillsPage: page(skills, 3, requested.skillsPage),
      insightsPage: page(insights, 4, requested.insightsPage),
      links: links(true),
    });
  }
  const resultsState = ["success", "new-threads"].includes(state);
  if (resultsState) {
    const resultInsights = insights.slice(1);
    return base({
      configuration: configured,
      pendingThreadCount: state === "new-threads" ? 8 : 0,
      pendingCandidateCount: 1,
      run: {
        hasActiveRun: false,
        hasEverSucceeded: true,
        latest: {
          status: "succeeded",
          completedAt: "2026-09-03T18:30:00.000Z",
        },
      },
      skillsPage: page(skills.slice(0, 1), 3, requested.skillsPage),
      insightsPage: page(resultInsights, 4, requested.insightsPage),
      links: links(true),
    });
  }
  if (state === "multiple-skills") {
    return base({
      configuration: configured,
      pendingCandidateCount: 2,
      run: {
        hasActiveRun: false,
        hasEverSucceeded: true,
        latest: {
          status: "succeeded",
          completedAt: "2026-09-03T18:30:00.000Z",
        },
      },
      skillsPage: page(skills, 3, requested.skillsPage),
      insightsPage: page(insights.slice(6), 4, requested.insightsPage),
      links: links(true),
    });
  }
  if (state === "insights-only") {
    return base({
      configuration: configured,
      run: {
        hasActiveRun: false,
        hasEverSucceeded: true,
        latest: {
          status: "succeeded",
          completedAt: "2026-09-03T18:30:00.000Z",
        },
      },
      insightsPage: page(insights, 4, requested.insightsPage),
      links: links(true),
    });
  }
  if (state === "threads-available") {
    return base({
      configuration: configured,
      pendingThreadCount: 8,
      links: links(true),
    });
  }
  if (state === "no-threads") {
    return base({ configuration: configured, links: links(true) });
  }
  if (state === "setup-error") {
    return base({
      configuration: { state: "invalid", reason: "instrumentation" },
    });
  }
  if (state === "empty-results") {
    return base({
      configuration: configured,
      run: {
        hasActiveRun: false,
        hasEverSucceeded: true,
        latest: {
          status: "succeeded",
          completedAt: "2026-09-03T18:30:00.000Z",
        },
      },
      links: links(true),
    });
  }
  if (state === "first-run") {
    return base({
      configuration: configured,
      run: {
        hasActiveRun: true,
        hasEverSucceeded: false,
        latest: { status: "reducing", completedAt: null },
      },
      links: links(true),
    });
  }
  if (state === "candidates-only") {
    return base({
      configuration: configured,
      pendingCandidateCount: 2,
      links: links(true),
    });
  }
  if (state === "selection-required") {
    return base({ configuration: { state: "selection_required" } });
  }
  return base({});
}

export function isLearningScreenshotState(
  value: string | null,
): value is LearningScreenshotState {
  return (
    typeof value === "string" &&
    (LEARNING_SCREENSHOT_STATES as readonly string[]).includes(value)
  );
}

export function isLearningLabState(
  value: string | null,
): value is LearningLabState {
  return value === "pagination" || isLearningScreenshotState(value);
}
