export interface DocsCtaAttribution {
  surface: string;
  frontend?: string;
  backend?: string;
}

function addDocsCtaAttribution(
  url: URL,
  { surface, frontend, backend }: DocsCtaAttribution,
): string {
  url.searchParams.set("utm_source", "docs");
  url.searchParams.set("utm_medium", "cta");
  url.searchParams.set("utm_campaign", "intelligence");
  url.searchParams.set("utm_content", surface);
  if (frontend) url.searchParams.set("utm_frontend", frontend);
  if (backend) url.searchParams.set("utm_backend", backend);
  return url.toString();
}

export function buildIntelligenceAuthEntryHref(
  opsPublicUrl: string,
  attribution: DocsCtaAttribution,
): string {
  const url = new URL("/sign-in", opsPublicUrl);
  url.searchParams.set("post_auth_redirect", "ready");
  return addDocsCtaAttribution(url, attribution);
}

export function buildTrackedDocsHref(
  destination: string,
  attribution: DocsCtaAttribution,
): string {
  return addDocsCtaAttribution(new URL(destination), attribution);
}
