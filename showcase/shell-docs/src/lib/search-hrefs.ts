import { frontendPathForBackend } from "@/lib/frontend-options";
import type { FrontendId } from "@/lib/frontend-options";

const ROOT_FRAMEWORK = "built-in-agent";
const FRONTEND_IDS = new Set([
  "vue",
  "react-native",
  "angular",
  "slack",
  "teams",
]);
type FrontendPageId = Exclude<FrontendId, "react">;

export function parseIntegrationDocsHref(
  href: string,
): { folder: string; topic: string } | null {
  const prefix = "/docs/integrations/";
  if (!href.startsWith(prefix)) return null;
  const rest = href.slice(prefix.length);
  const [folder, ...topicParts] = rest.split("/").filter(Boolean);
  if (!folder) return null;
  return { folder, topic: topicParts.join("/") };
}

export function parseDocsHref(href: string): string | null {
  if (!href.startsWith("/docs/")) return null;
  if (href.startsWith("/docs/integrations/")) return null;
  if (href.startsWith("/docs/frontends/")) return null;
  return href.slice("/docs/".length);
}

export function frameworkDocsHref(
  framework: string,
  topic: string,
  frontend?: FrontendPageId | null,
): string {
  if (frontend) {
    return frontendPathForBackend(
      frontend,
      topic,
      framework === ROOT_FRAMEWORK ? null : framework,
    );
  }

  if (framework === ROOT_FRAMEWORK) {
    return topic ? `/${topic}` : "/";
  }
  return topic ? `/${framework}/${topic}` : `/${framework}`;
}

export function normalizeHref(href: string, shellHost: string): string {
  if (href === "/integrations" || href === "/matrix") {
    return `${shellHost}${href}`;
  }

  const frontendDocsPrefix = "/docs/frontends/";
  if (href.startsWith(frontendDocsPrefix)) {
    const [frontend, ...tail] = href
      .slice(frontendDocsPrefix.length)
      .split("/")
      .filter(Boolean);

    // Regenerated indexes expand shared frontend guidance once per frontend.
    // This only protects users with a stale index from landing on 404.
    if (frontend === "using-these-docs" || frontend === "docs-status") {
      return "/vue/using-these-docs";
    }
    if (FRONTEND_IDS.has(frontend)) {
      return tail.length > 0
        ? `/${frontend}/${tail.join("/")}`
        : `/${frontend}`;
    }
  }

  const rootDocsPrefix = `/docs/${ROOT_FRAMEWORK}`;
  if (href === rootDocsPrefix) return "/";
  if (href.startsWith(`${rootDocsPrefix}/`)) {
    return href.slice(rootDocsPrefix.length) || "/";
  }

  const rootIntegrationDocsPrefix = `/docs/integrations/${ROOT_FRAMEWORK}`;
  if (href === rootIntegrationDocsPrefix) return "/";
  if (href.startsWith(`${rootIntegrationDocsPrefix}/`)) {
    return href.slice(rootIntegrationDocsPrefix.length) || "/";
  }

  if (href.startsWith("/docs/")) {
    return href.slice("/docs".length) || "/";
  }
  return href;
}
