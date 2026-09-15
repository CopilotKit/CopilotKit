import { LandingIntegrationPicker } from "./landing-integration-picker";
import { FRONTEND_OPTIONS } from "@/lib/frontend-options";
import { landingIntegrations } from "@/lib/landing-integrations";

// Send only the labels, logos, and destinations across the client boundary.
export function DocsLandingNext() {
  return (
    <section
      id="backends"
      aria-labelledby="integrations-heading"
      className="not-prose"
    >
      <h2
        id="integrations-heading"
        className="text-[1.75rem] font-semibold leading-tight tracking-[-0.035em] text-[var(--text)] sm:text-[2rem]"
      >
        Fits the stack you already have.
      </h2>
      <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-[var(--text-secondary)]">
        Choose your frontend, then explore an agent integration.
      </p>
      <LandingIntegrationPicker
        frontends={FRONTEND_OPTIONS.map((option) => ({
          id: option.id,
          name: option.name,
          summary: option.summary,
          logo: { kind: "frontend" as const, icon: option.icon },
        }))}
        integrations={landingIntegrations()}
      />
    </section>
  );
}
