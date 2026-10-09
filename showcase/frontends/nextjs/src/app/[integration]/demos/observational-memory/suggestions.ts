import { useConfigureSuggestions } from "@copilotkit/react-core/v2";

// Observational Memory fires on UNOBSERVED MESSAGE-TOKEN SIZE, not turn count.
// The floor that reliably trips OM's async buffering is ~600 message tokens.
// Both pills below send deliberately large multi-paragraph messages so a
// single click pushes the conversation over the threshold and the Observer
// runs — surfacing the `mastra-observational-memory` activity card.

const PROJECT_BRIEF = `Here is a lot of context about my project. I'm building a B2B analytics platform called Northwind Insights. The core product is a dashboard that ingests events from our customers' web and mobile apps, runs them through a streaming pipeline, and surfaces funnels, retention cohorts, and revenue attribution. Our stack is a Next.js frontend, a Node.js ingestion service behind an API gateway, Kafka for the event bus, ClickHouse for the analytical store, and Postgres for application metadata. We deploy on AWS with EKS, and we use Terraform for infra. The team is eight engineers split across frontend, backend, and data. Our biggest customers are mid-market SaaS companies with fifty to five hundred employees, and our top three by revenue are Acme Retail, Globex, and Initech. Our current north-star metric is weekly active dashboards, and we're at about twelve hundred right now, up from eight hundred last quarter. The main pain points our customers report are slow query times on large date ranges, confusing funnel configuration, and a lack of alerting when metrics move sharply. On the roadmap we have anomaly detection, a self-serve SQL editor, and SSO via SAML. Our pricing is seat-based with a usage overage on event volume, and churn has been creeping up among smaller accounts who find the setup too heavy.

Now, given all of that, summarize the top three product risks you see and suggest one concrete mitigation for each.`;

const TRIP_ITINERARY = `I want your help planning a two-week trip, and here's all the context you'll need. I'm traveling from San Francisco in late September with my partner. We both love hiking, good food, and small towns over big cities, and we want to avoid anything too touristy or crowded. Our budget is around six thousand dollars total excluding flights, and we'd prefer to rent a car for at least part of the trip so we have flexibility. We're thinking of northern Italy and the Dolomites, but we're open to Slovenia and Austria too if it makes the route better. My partner is vegetarian, and I have a mild shellfish allergy, so restaurant recommendations should account for that. We like staying in family-run guesthouses rather than large hotels, and we want at least a few days of serious multi-day hiking with hut-to-hut routes. Neither of us speaks Italian or German beyond the basics. We're moderately fit — we can do six to eight hour hiking days but not technical climbing. We'd also like one or two rest days built in around a spa or thermal baths, and we care a lot about scenic drives. We're flying home from wherever makes sense, not necessarily back to the same city.

With all that in mind, sketch a rough two-week itinerary with a suggested base town for each stretch and why.`;

export function useObservationalMemorySuggestions() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Brief my analytics project",
        message: PROJECT_BRIEF,
      },
      {
        title: "Plan a two-week trip",
        message: TRIP_ITINERARY,
      },
    ],
    available: "always",
  });
}
