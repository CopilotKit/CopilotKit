export const ROOT_QUICKSTART_FRAMEWORK = "built-in-agent";

export const FRONTEND_QUICKSTARTS = [
  {
    slug: "react",
    label: "React",
    shortLabel: "React",
    iconKey: "react",
    sourceSlugPath: "quickstart",
  },
  {
    slug: "vue",
    label: "Vue",
    shortLabel: "Vue",
    iconKey: "vue",
    sourceSlugPath: "vue",
  },
  {
    slug: "react-native",
    label: "React Native",
    shortLabel: "Native",
    iconKey: "react-native",
    sourceSlugPath: "react-native",
  },
  {
    slug: "slack",
    label: "Slack",
    shortLabel: "Slack",
    iconKey: "slack",
    sourceSlugPath: "slack",
  },
  {
    slug: "microsoft-teams",
    label: "Microsoft Teams",
    shortLabel: "Teams",
    iconKey: "microsoft-teams",
    sourceSlugPath: "microsoft-teams",
  },
] as const;

export type FrontendQuickstartSlug =
  (typeof FRONTEND_QUICKSTARTS)[number]["slug"];

const FRONTEND_QUICKSTART_SLUGS = new Set<string>(
  FRONTEND_QUICKSTARTS.map((frontend) => frontend.slug),
);
const FRONTEND_QUICKSTART_BY_SLUG = new Map(
  FRONTEND_QUICKSTARTS.map((frontend) => [frontend.slug, frontend]),
);

export function isFrontendQuickstartSlug(
  slug: string | null | undefined,
): slug is FrontendQuickstartSlug {
  return Boolean(slug && FRONTEND_QUICKSTART_SLUGS.has(slug));
}

export function selectedFrontendQuickstart(
  slugPath: string,
): FrontendQuickstartSlug | null {
  const normalized = slugPath.replace(/^\/+|\/+$/g, "");
  if (normalized === "quickstart") return "react";
  if (isFrontendQuickstartSlug(normalized)) {
    return normalized;
  }

  const match = normalized.match(/^quickstart\/([^/]+)$/);
  if (!match) return null;
  const slug = match[1];
  return isFrontendQuickstartSlug(slug) ? slug : null;
}

export function frontendQuickstartContentSlugPath(slugPath: string): string {
  const selected = selectedFrontendQuickstart(slugPath);
  if (!selected) return slugPath;

  const quickstart = FRONTEND_QUICKSTART_BY_SLUG.get(selected);
  return quickstart?.sourceSlugPath ?? slugPath;
}

export function frontendQuickstartHref(
  framework: string | null | undefined,
  frontend: FrontendQuickstartSlug,
): string {
  const prefix =
    framework && framework !== ROOT_QUICKSTART_FRAMEWORK ? `/${framework}` : "";
  return `${prefix}/${frontend}`;
}
