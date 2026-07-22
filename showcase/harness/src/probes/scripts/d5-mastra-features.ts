/**
 * Shared frontend probes for the Mastra-only feature family.
 *
 * Background tasks and observational memory are fixture-backed and assert
 * their protocol-specific activity surfaces. Browser Use is deliberately a
 * no-turn hydration smoke: its local browser reads live pages, so replaying a
 * response would hide the capability being demonstrated and a live request
 * would make the merge gate depend on network, credentials, and changing data.
 */
import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext, D5FeatureType } from "../helpers/d5-registry.js";
import type { ConversationTurn } from "../helpers/conversation-runner.js";

const OBSERVATIONAL_MEMORY_PROJECT_BRIEF = `Here is a lot of context about my project. I'm building a B2B analytics platform called Northwind Insights. The core product is a dashboard that ingests events from our customers' web and mobile apps, runs them through a streaming pipeline, and surfaces funnels, retention cohorts, and revenue attribution. Our stack is a Next.js frontend, a Node.js ingestion service behind an API gateway, Kafka for the event bus, ClickHouse for the analytical store, and Postgres for application metadata. We deploy on AWS with EKS, and we use Terraform for infra. The team is eight engineers split across frontend, backend, and data. Our biggest customers are mid-market SaaS companies with fifty to five hundred employees, and our top three by revenue are Acme Retail, Globex, and Initech. Our current north-star metric is weekly active dashboards, and we're at about twelve hundred right now, up from eight hundred last quarter. The main pain points our customers report are slow query times on large date ranges, confusing funnel configuration, and a lack of alerting when metrics move sharply. On the roadmap we have anomaly detection, a self-serve SQL editor, and SSO via SAML. Our pricing is seat-based with a usage overage on event volume, and churn has been creeping up among smaller accounts who find the setup too heavy.

Now, given all of that, summarize the top three product risks you see and suggest one concrete mitigation for each.`;

/** Build the fixture-backed background-task activity turn. */
export function buildBackgroundAgentsTurns(
  _context: D5BuildContext,
): ConversationTurn[] {
  return [
    {
      input:
        "Kick off deep research on the current landscape of AI agent frameworks.",
      responseTimeoutMs: 60_000,
      completeOnMount: {
        testIds: ["background-task-activity", "background-task-status"],
        minNewMounts: 2,
      },
    },
  ];
}

/** Build the threshold-sized observational-memory activity turn. */
export function buildObservationalMemoryTurns(
  _context: D5BuildContext,
): ConversationTurn[] {
  return [
    {
      input: OBSERVATIONAL_MEMORY_PROJECT_BRIEF,
      responseTimeoutMs: 60_000,
      completeOnMount: {
        testIds: ["om-activity-card", "om-status-dot"],
        minNewMounts: 2,
      },
    },
  ];
}

/** Keep Browser Use deterministic by testing navigation and hydration only. */
export function buildBrowserUseTurns(
  _context: D5BuildContext,
): ConversationTurn[] {
  return [];
}

/** Resolve closed Mastra probe literals to their public demo routes. */
export function preNavigateMastraRoute(featureType: D5FeatureType): string {
  return featureType === "browser-use-smoke"
    ? "/demos/browser-use"
    : `/demos/${featureType}`;
}

registerD5Script({
  featureTypes: ["background-agents"],
  fixtureFile: "background-agents.json",
  buildTurns: buildBackgroundAgentsTurns,
  preNavigateRoute: preNavigateMastraRoute,
});

registerD5Script({
  featureTypes: ["observational-memory"],
  fixtureFile: "observational-memory.json",
  buildTurns: buildObservationalMemoryTurns,
  preNavigateRoute: preNavigateMastraRoute,
});

registerD5Script({
  featureTypes: ["browser-use-smoke"],
  buildTurns: buildBrowserUseTurns,
  preNavigateRoute: preNavigateMastraRoute,
});
