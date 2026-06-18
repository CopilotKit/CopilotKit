const ROOT_FRAMEWORK = "built-in-agent";

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
  return href.slice("/docs/".length);
}

export function frameworkDocsHref(framework: string, topic: string): string {
  if (framework === ROOT_FRAMEWORK) {
    return topic ? `/${topic}` : "/";
  }
  return topic ? `/${framework}/${topic}` : `/${framework}`;
}

export function normalizeHref(href: string, shellHost: string): string {
  if (href === "/integrations" || href === "/matrix") {
    return `${shellHost}${href}`;
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
