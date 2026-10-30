/**
 * Frontend-side seed for the Dashboard Designer (ADK) demo.
 *
 * The LangGraph agent seeds `state.issues` via a `before_model` hook
 * (apps/agent/main.py); the ADK agent doesn't have an equivalent, so the
 * Dashboard pane would render empty on first load. Rather than fight ADK,
 * we seed from the frontend — it's a mock demo and an empty backlog
 * defeats the point. Mirrors the 20-issue payload in
 * apps/agent/src/issues.py exactly so the two demos feel identical.
 */
import type { Issue } from "@/components/pm-board/types";

export const SEED_ISSUES: Issue[] = [
  {
    id: "ISS-101",
    title: "Payment integration flaky on Safari",
    description:
      "Customers on Safari 17 see the Stripe Elements iframe fail to mount about 1 in 8 sessions. Repro steps in the linked Sentry trace; suspect CORS preflight timeout.",
    status: "In Progress",
    priority: "Urgent",
    assignee: "Alex",
    labels: ["bug", "payments"],
    dueDate: "2026-05-22",
  },
  {
    id: "ISS-102",
    title: "Q3 roadmap kickoff",
    description:
      "Pull together the candidate list of Q3 themes and circulate to leadership for prioritization by end of week.",
    status: "Todo",
    priority: "High",
    assignee: "Sarah",
    labels: ["planning"],
    dueDate: "2026-05-24",
  },
  {
    id: "ISS-103",
    title: "Migrate auth middleware off legacy session store",
    description:
      "We still have one path that reads from the old Redis session format. Cut it over to the new JWT flow.",
    status: "In Review",
    priority: "High",
    assignee: "Jordan",
    labels: ["infra", "tech-debt"],
    dueDate: "2026-05-20",
  },
  {
    id: "ISS-104",
    title: "Onboarding tour skips step 3 on mobile",
    description:
      "The 'invite teammates' step only renders on viewports > 768px. Add the mobile layout.",
    status: "Todo",
    priority: "Med",
    assignee: "Priya",
    labels: ["bug", "frontend"],
  },
  {
    id: "ISS-105",
    title: "Improve API rate-limit error copy",
    description:
      "The current 429 surface just says 'Too many requests'. Add a retry-after hint and a link to docs.",
    status: "Backlog",
    priority: "Low",
    assignee: "Alex",
    labels: ["polish"],
  },
  {
    id: "ISS-106",
    title: "Add dark mode to invoice PDF template",
    description:
      "Customer-facing invoices currently fail to render correctly when the workspace theme is dark.",
    status: "Backlog",
    priority: "Low",
    assignee: "Sarah",
    labels: ["design"],
  },
  {
    id: "ISS-107",
    title: "Postgres connection pool exhaustion at peak",
    description:
      "Pool fills at ~3 PM PT on weekdays. Either tune pool size or add a read replica for analytics queries.",
    status: "In Progress",
    priority: "Urgent",
    assignee: "Jordan",
    labels: ["infra", "performance"],
    dueDate: "2026-05-19",
  },
  {
    id: "ISS-108",
    title: "Customer interview synthesis — Q2 cohort",
    description:
      "Synthesize the 12 customer interviews from April into a 1-page memo with three opportunity areas.",
    status: "Todo",
    priority: "Med",
    assignee: "Priya",
    labels: ["research"],
    dueDate: "2026-05-26",
  },
  {
    id: "ISS-109",
    title: "Replace homepage hero illustration",
    description:
      "Marketing has new brand art. Swap the SVG and update the alt text.",
    status: "Done",
    priority: "Low",
    assignee: "Sarah",
    labels: ["marketing"],
  },
  {
    id: "ISS-110",
    title: "Audit npm dependencies for CVEs",
    description:
      "Run a fresh `npm audit` across the workspace and triage the highs. Document the false-positive cases.",
    status: "In Review",
    priority: "Med",
    assignee: "Alex",
    labels: ["security", "tech-debt"],
  },
  {
    id: "ISS-111",
    title: "Search results pagination drops query param",
    description:
      "Clicking page 2 resets the search filter. Fix the URL builder in SearchResults.tsx.",
    status: "Backlog",
    priority: "Med",
    assignee: "Jordan",
    labels: ["bug", "frontend"],
  },
  {
    id: "ISS-112",
    title: "Write blog post: how we cut p95 latency 40%",
    description: "Draft and review with eng leadership before publishing.",
    status: "Todo",
    priority: "Low",
    assignee: "Priya",
    labels: ["marketing", "writing"],
  },
  {
    id: "ISS-113",
    title: "GDPR data export endpoint",
    description:
      "EU customers need a self-serve way to export their full account data. Schema design + endpoint.",
    status: "Backlog",
    priority: "High",
    assignee: "Sarah",
    labels: ["compliance", "backend"],
    dueDate: "2026-06-15",
  },
  {
    id: "ISS-114",
    title: "Replace lodash with native ES utilities",
    description:
      "Bundle size win, plus the migration off lodash means we drop one transitive vulnerable dep.",
    status: "In Progress",
    priority: "Low",
    assignee: "Alex",
    labels: ["tech-debt", "frontend"],
  },
  {
    id: "ISS-115",
    title: "Onboarding email sequence A/B test",
    description:
      "Test sending day-3 email at 9 AM local vs. 5 PM local. Looking for activation lift.",
    status: "In Review",
    priority: "Med",
    assignee: "Priya",
    labels: ["growth", "experiment"],
  },
  {
    id: "ISS-116",
    title: "Sketch checkout redesign in Excalidraw",
    description:
      "Quick whiteboard pass before we commit to a Figma file. Cover guest checkout + upsell modal.",
    status: "Backlog",
    priority: "Med",
    assignee: "Sarah",
    labels: ["design"],
  },
  {
    id: "ISS-117",
    title: "Migrate analytics events to typed schema",
    description:
      "Stop relying on free-form event names. Generate a TS union from a single source of truth.",
    status: "Todo",
    priority: "Med",
    assignee: "Jordan",
    labels: ["tech-debt", "analytics"],
  },
  {
    id: "ISS-118",
    title: "Bug: Slack notifications duplicate on retry",
    description:
      "Our retry middleware doesn't dedupe webhook calls. Customers are seeing the same message twice when our worker scales.",
    status: "In Progress",
    priority: "High",
    assignee: "Alex",
    labels: ["bug", "integrations"],
    dueDate: "2026-05-21",
  },
  {
    id: "ISS-119",
    title: "Performance: bundle size budget for /app",
    description:
      "Set up a CI check that fails the build if the main bundle grows past 300kb gzipped.",
    status: "Backlog",
    priority: "Low",
    assignee: "Jordan",
    labels: ["performance", "ci"],
  },
  {
    id: "ISS-120",
    title: "Update terms of service for new pricing",
    description:
      "Legal review for the metered-usage clause. Coordinate with finance on the effective date.",
    status: "Done",
    priority: "Med",
    assignee: "Priya",
    labels: ["compliance"],
  },
];
