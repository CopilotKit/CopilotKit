// The other CopilotKit hosts the docs link to and frame. Each deployment
// reads its own from the environment (src/lib/runtime-config.ts), so staging
// docs send readers to the staging dashboard and frame staging demos; these
// production values are the defaults. Safe to import anywhere.

export interface SiteHosts {
  /** The showcase shell, e.g. `/angular/<integration>/<feature>`. */
  showcaseUrl: string;
  /** The CopilotKit dashboard: Intelligence sign-up, Copilot Cloud, API keys. */
  dashboardUrl: string;
  /** Each framework's demo deployment: a bare host with `{slug}` in it. */
  demoHostPattern: string;
}

export const PRODUCTION_SITE_HOSTS: SiteHosts = {
  showcaseUrl: "https://showcase.copilotkit.ai",
  dashboardUrl: "https://dashboard.operations.copilotkit.ai",
  // The showcase's own default (showcase/scripts/generate-registry.ts).
  demoHostPattern: "showcase-{slug}-production.up.railway.app",
};

/** A framework's demo deployment, e.g. `https://showcase-mastra-production.up.railway.app`. */
export function demoOrigin(hosts: SiteHosts, slug: string): string {
  return `https://${hosts.demoHostPattern.replaceAll("{slug}", () => slug)}`;
}
