export const CHANNEL_FRONTENDS = ["slack", "teams"] as const;

export type ChannelFrontend = (typeof CHANNEL_FRONTENDS)[number];

export const DEFAULT_CHANNEL_FRAMEWORK = "built-in-agent";

export type ChannelGuideSection = "getting-started" | "build" | "production";

export interface ChannelGuideRoute {
  readonly slug: string;
  readonly sourceSlug: string;
  readonly navTitle: string;
  readonly section: ChannelGuideSection;
}

export type ChannelFrameworkDocsMode = "generated" | "authored" | "hidden";

export interface ResolveChannelGuideRouteInput {
  readonly frontend: string;
  readonly framework: string | null | undefined;
  readonly slugPath: string;
  readonly frameworkDocsMode: ChannelFrameworkDocsMode;
}

export interface ChannelGuideRouteResolution {
  readonly frontend: ChannelFrontend;
  readonly framework: string;
  readonly slugPath: string;
  readonly sourceSlug: string;
  readonly canonicalPath: string;
}

export const CHANNEL_GUIDE_ROUTES = [
  {
    slug: "overview",
    sourceSlug: "channels",
    navTitle: "Overview",
    section: "getting-started",
  },
  {
    slug: "intelligence",
    sourceSlug: "channels/intelligence",
    navTitle: "Configure the Channel in Intelligence",
    section: "getting-started",
  },
  {
    slug: "tools",
    sourceSlug: "channels/tools",
    navTitle: "Tools and context",
    section: "build",
  },
  {
    slug: "identity-and-memory",
    sourceSlug: "channels/identity-and-memory",
    navTitle: "Identity and Memory",
    section: "build",
  },
  {
    slug: "rich-messages",
    sourceSlug: "channels/rich-messages",
    navTitle: "Rich messages and components",
    section: "build",
  },
  {
    slug: "interactive",
    sourceSlug: "channels/interactive",
    navTitle: "Interactive messages and approvals",
    section: "build",
  },
  {
    slug: "commands-and-reactions",
    sourceSlug: "channels/commands-and-reactions",
    navTitle: "Commands and reactions",
    section: "build",
  },
  {
    slug: "files-and-multimodality",
    sourceSlug: "channels/files-and-multimodality",
    navTitle: "Files and multimodal input",
    section: "build",
  },
  {
    slug: "threads-and-state",
    sourceSlug: "channels/threads-and-state",
    navTitle: "Threads and state",
    section: "build",
  },
  {
    slug: "multiple-agents",
    sourceSlug: "channels/multiple-agents",
    navTitle: "Multiple agents",
    section: "build",
  },
  {
    slug: "persistence-and-scaling",
    sourceSlug: "channels/persistence-and-scaling",
    navTitle: "Persistence and scaling",
    section: "production",
  },
  {
    slug: "history-and-transcripts",
    sourceSlug: "channels/history-and-transcripts",
    navTitle: "History and transcripts",
    section: "production",
  },
  {
    slug: "deploy-and-operate",
    sourceSlug: "channels/deploy-and-operate",
    navTitle: "Deploy and operate",
    section: "production",
  },
] as const satisfies readonly ChannelGuideRoute[];

const SOURCE_SLUG_BY_PUBLIC_SLUG: ReadonlyMap<string, string> = new Map(
  CHANNEL_GUIDE_ROUTES.map(({ slug, sourceSlug }) => [slug, sourceSlug]),
);

const PUBLIC_SLUG_BY_SOURCE_SLUG: ReadonlyMap<string, string> = new Map(
  CHANNEL_GUIDE_ROUTES.map(({ slug, sourceSlug }) => [sourceSlug, slug]),
);

function normalizeSlugPath(slugPath: string): string {
  return slugPath.split("/").filter(Boolean).join("/");
}

export function getChannelGuideSourceSlug(publicSlug: string): string | null {
  return SOURCE_SLUG_BY_PUBLIC_SLUG.get(normalizeSlugPath(publicSlug)) ?? null;
}

export function getChannelGuidePublicSlug(sourceSlug: string): string | null {
  return PUBLIC_SLUG_BY_SOURCE_SLUG.get(normalizeSlugPath(sourceSlug)) ?? null;
}

export function isChannelGuideSlug(slug: string): boolean {
  return SOURCE_SLUG_BY_PUBLIC_SLUG.has(normalizeSlugPath(slug));
}

function isSupportedChannelFrontend(
  frontend: string,
): frontend is ChannelFrontend {
  return CHANNEL_FRONTENDS.some((candidate) => candidate === frontend);
}

export function resolveChannelGuideRoute(
  input: ResolveChannelGuideRouteInput,
): ChannelGuideRouteResolution | null {
  if (
    input.frameworkDocsMode === "hidden" ||
    !isSupportedChannelFrontend(input.frontend)
  ) {
    return null;
  }

  const slugPath = normalizeSlugPath(input.slugPath);
  const sourceSlug = SOURCE_SLUG_BY_PUBLIC_SLUG.get(slugPath);
  if (!sourceSlug) return null;

  const framework =
    normalizeSlugPath(input.framework ?? "") || DEFAULT_CHANNEL_FRAMEWORK;

  return {
    frontend: input.frontend,
    framework,
    slugPath,
    sourceSlug,
    canonicalPath: channelGuideHref(input.frontend, framework, slugPath),
  };
}

export function channelGuideHref(
  frontend: ChannelFrontend,
  framework: string | null | undefined,
  slugPath: string,
): string {
  const normalizedFramework = normalizeSlugPath(framework ?? "");
  const normalizedSlugPath = normalizeSlugPath(slugPath);
  const publicSlugPath =
    normalizedSlugPath === "overview" ? "" : normalizedSlugPath;
  const segments = [
    frontend,
    normalizedFramework === DEFAULT_CHANNEL_FRAMEWORK
      ? ""
      : normalizedFramework,
    publicSlugPath,
  ].filter(Boolean);

  return `/${segments.join("/")}`;
}

export function channelConnectHref(
  frontend: ChannelFrontend,
  framework: string | null | undefined,
): string {
  return channelGuideHref(frontend, framework, "connect");
}
