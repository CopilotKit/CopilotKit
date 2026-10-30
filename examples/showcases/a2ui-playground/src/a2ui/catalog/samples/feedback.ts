import type { ComponentName } from "../definitions";
import type { Sample } from "./types";

export const feedbackSamples: Partial<Record<ComponentName, Sample>> = {
  Alert: { components: [{ id: "root", component: "Alert", tone: "warning", title: "Usage at 92% of plan", message: "You will hit the request limit in about 3 days at the current rate." }] },
  Callout: { components: [{ id: "root", component: "Callout", title: "Tip", text: "Fixed-schema surfaces paint as soon as the data lands. Use them for the requests you see every day.", actionLabel: "Learn more", onAction: { event: { name: "learn_more" } } }] },
  Skeleton: { components: [{ id: "root", component: "Skeleton", variant: "card" }] },
  EmptyState: { components: [{ id: "root", component: "EmptyState", title: "No invoices yet", description: "Invoices appear here once your first billing cycle closes.", actionLabel: "Create invoice", onAction: { event: { name: "create_invoice" } } }] },
};
