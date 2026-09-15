import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { FrameworkLogo } from "./icons/framework-icons";
import { PickLogoMark } from "./docs-map-parts";
import { compareByDisplayOrder } from "@/lib/framework-order";
import { frontendPicks, visibleIntegrations } from "@/lib/homepage-map";
import type { Integration } from "@/lib/registry";

// Keep the landing page short while leaving every supported integration
// discoverable. Registry data stays on the server.
const FEATURED_BACKENDS = new Set([
  "built-in-agent",
  "deepagents",
  "langgraph-python",
  "google-adk",
  "mastra",
  "claude-sdk-python",
]);

function IntegrationLink({ integration }: { integration: Integration }) {
  return (
    <Link
      href={
        integration.slug === "built-in-agent"
          ? "/quickstart"
          : `/${integration.slug}`
      }
      className="group flex min-h-16 items-center gap-3 border-b border-[var(--border)] py-3 text-sm text-[var(--text-secondary)] no-underline transition-colors hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
    >
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center text-[var(--text-muted)] group-hover:text-[var(--accent)]"
      >
        <FrameworkLogo
          slug={integration.slug}
          fallbackSrc={integration.logo}
          size={21}
        />
      </span>
      <span className="flex-1 font-medium">{integration.name}</span>
      <ArrowUpRight
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"
      />
    </Link>
  );
}

export function DocsLandingNext() {
  const integrations = visibleIntegrations()
    .slice()
    .sort((a, b) => {
      if (a.slug === "built-in-agent") return -1;
      if (b.slug === "built-in-agent") return 1;
      return compareByDisplayOrder(a.slug, b.slug);
    });
  const featured = integrations.filter((i) => FEATURED_BACKENDS.has(i.slug));
  const remaining = integrations.filter((i) => !FEATURED_BACKENDS.has(i.slug));

  return (
    <section
      id="backends"
      aria-labelledby="integrations-heading"
      className="not-prose border-t border-[var(--border)] pt-12 sm:pt-16"
    >
      <h2
        id="integrations-heading"
        className="text-[1.75rem] font-semibold leading-tight tracking-[-0.035em] text-[var(--text)] sm:text-[2rem]"
      >
        Fits the stack you already have.
      </h2>
      <p className="mt-3 max-w-[58ch] text-sm leading-relaxed text-[var(--text-secondary)]">
        Bring your own agent backend, or start with CopilotKit’s built-in agent.
        Explore each integration for setup guides and supported features.
      </p>
      <div className="mt-8">
        <h3 className="text-xs font-medium text-[var(--text-muted)]">
          Your frontend
        </h3>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
          {frontendPicks().map((frontend) => (
            <li key={frontend.id}>
              <Link
                href={
                  frontend.id === "react" ? "/quickstart" : `/${frontend.id}`
                }
                className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
              >
                <span aria-hidden="true">
                  <PickLogoMark logo={frontend.logo} size={18} />
                </span>
                {frontend.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-8">
        <h3 className="text-xs font-medium text-[var(--text-muted)]">
          Your agent backend
        </h3>
        <div className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((integration) => (
            <IntegrationLink key={integration.slug} integration={integration} />
          ))}
        </div>
        {remaining.length > 0 && (
          <details className="group/directory mt-5">
            <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-sm font-medium text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)] [&::-webkit-details-marker]:hidden">
              Explore {remaining.length} more integrations
              <ChevronDown
                aria-hidden="true"
                className="h-4 w-4 transition-transform group-open/directory:rotate-180"
              />
            </summary>
            <div className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
              {remaining.map((integration) => (
                <IntegrationLink
                  key={integration.slug}
                  integration={integration}
                />
              ))}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
