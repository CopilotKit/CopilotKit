import type { InspectorMetadataProjection } from "./inspector-metadata.js";

export type HomeStory = {
  title: string;
  bodyMarkdown: string;
  href?: string;
};

export type HomeHeroActionKind =
  | "enable_intelligence"
  | "manage_plan"
  | "renew";

export type HomeHeroAction = {
  kind: HomeHeroActionKind;
  url: string;
  label: string;
};

export type HomeConnection = "connected" | "disconnected";

export type HomeServiceTile = {
  id: string;
  label: string;
  on: boolean;
  url?: string;
  docsUrl?: string;
};

export type HomeModel = {
  firstOpen: boolean;
  unreadAnnouncement: boolean;
  hero: {
    connection: HomeConnection;
    title: string;
    body: string;
    action?: HomeHeroAction;
  };
  project?: {
    organizationName: string;
    projectName: string;
    planLabel?: string;
    license: string;
    usage?: {
      used: number;
      limitLabel: string;
      ratio?: number;
    };
  };
  projectLinked: boolean;
  runtime: {
    url?: string;
    version?: string;
    mode?: string;
    agentCount: number;
    available: boolean;
  };
  services: HomeServiceTile[];
  news?: {
    featured: HomeStory;
    stories: HomeStory[];
    fallbackHtml?: string;
  };
};

export type HomeBriefingInput = {
  firstOpen: boolean;
  unreadAnnouncement: boolean;
  connected: boolean;
  threadsAvailable: boolean;
  metadata: InspectorMetadataProjection;
  runtimeUrl?: string;
  runtimeVersion?: string;
  runtimeMode?: string;
  agentNames: string[];
  memoriesOn: boolean;
  a2uiOn: boolean;
  openGenUiOn: boolean;
  suggestionsOn: boolean;
  audioOn: boolean;
  websocketUrl?: string;
  announcementMarkdown?: string;
  announcementHtml?: string;
  intelligenceSignupUrl?: string;
};

const SERVICE_DOCS_URL: Record<string, string> = {
  threads: "https://docs.copilotkit.ai/threads",
  memory: "https://docs.copilotkit.ai/premium/intelligence-platform",
  a2ui: "https://docs.copilotkit.ai/generative-ui/a2ui",
  "open-gen-ui": "https://docs.copilotkit.ai/generative-ui/open-generative-ui",
  suggestions: "https://docs.copilotkit.ai/agentic-chat-ui",
  audio: "https://docs.copilotkit.ai/voice",
  websocket: "https://docs.copilotkit.ai/premium/intelligence-platform",
};

/** Split announcement markdown on `##` headings into story cards. */
export function splitAnnouncementMarkdown(markdown: string): HomeStory[] {
  const trimmed = markdown.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const stories: HomeStory[] = [];
  const parts = trimmed.split(/^## /m);
  for (const part of parts) {
    const chunk = part.trim();
    if (chunk.length === 0) {
      continue;
    }

    const newline = chunk.indexOf("\n");
    const title = (newline === -1 ? chunk : chunk.slice(0, newline)).trim();
    const bodyMarkdown = newline === -1 ? "" : chunk.slice(newline + 1).trim();
    if (title.length === 0 || title.startsWith("#")) {
      continue;
    }

    stories.push({ title, bodyMarkdown });
  }

  return stories;
}

/** Return the Home hero button for a trusted metadata action. */
export function homeHeroActionFromMetadata(action: {
  kind: HomeHeroActionKind;
  url: string;
}): HomeHeroAction {
  if (action.kind === "manage_plan") {
    return { kind: action.kind, url: action.url, label: "MANAGE PLAN" };
  }

  if (action.kind === "renew") {
    return { kind: action.kind, url: action.url, label: "RENEW" };
  }

  return {
    kind: action.kind,
    url: action.url,
    label: "CONNECT TO INTELLIGENCE",
  };
}

/** Return the last http(s) markdown link in a story, if one exists. */
export function announcementStoryHref(markdown: string): string | undefined {
  const matches = [...markdown.matchAll(/\]\((https?:[^)\s]+)\)/g)];
  const href = matches.at(-1)?.[1];
  return href && href.length > 0 ? href : undefined;
}

/** Return a short preview from markdown, without links or headings. */
export function announcementPreview(markdown: string, maxLength = 140): string {
  const plain = markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLength) {
    return plain;
  }

  return `${plain.slice(0, maxLength).trimEnd()}…`;
}

function connectIntelligenceAction(
  action: HomeHeroAction | undefined,
  connectUrl?: string,
): HomeHeroAction | undefined {
  if (action?.kind === "enable_intelligence") {
    return action;
  }

  if (connectUrl) {
    return {
      kind: "enable_intelligence",
      url: connectUrl,
      label: "CONNECT TO INTELLIGENCE",
    };
  }

  return action;
}

function heroForState(args: {
  projectLinked: boolean;
  action?: HomeHeroAction;
  connectUrl?: string;
}): HomeModel["hero"] {
  if (!args.projectLinked) {
    return {
      connection: "disconnected",
      title: "Connect to Intelligence",
      body: "Threads and Memory need Intelligence. Connect it to inspect conversations and recall.",
      action: connectIntelligenceAction(args.action, args.connectUrl),
    };
  }

  return {
    connection: "connected",
    title: "Connected to Intelligence",
    body: "Use Workbench to inspect threads and memory.",
    action:
      args.action?.kind === "enable_intelligence" ? undefined : args.action,
  };
}

function usageFromMetadata(metadata: InspectorMetadataProjection):
  | {
      used: number;
      limitLabel: string;
      ratio?: number;
    }
  | undefined {
  const usage = metadata.usage;
  if (!usage) {
    return undefined;
  }

  if (usage.limit.kind === "finite") {
    return {
      used: usage.used,
      limitLabel: `${usage.used} / ${usage.limit.value}`,
      ratio: usage.limit.value === 0 ? 1 : usage.used / usage.limit.value,
    };
  }

  if (usage.limit.kind === "unlimited") {
    return {
      used: usage.used,
      limitLabel: `${usage.used} / unlimited`,
    };
  }

  return {
    used: usage.used,
    limitLabel: `${usage.used} used`,
  };
}

function newsFromAnnouncement(args: {
  markdown?: string;
  html?: string;
}): HomeModel["news"] {
  if (args.markdown) {
    const stories = splitAnnouncementMarkdown(args.markdown);
    if (stories.length > 0) {
      const [featured, ...rest] = stories;
      if (featured) {
        return {
          featured: {
            ...featured,
            href: announcementStoryHref(featured.bodyMarkdown),
          },
          stories: rest.map((story) => ({
            ...story,
            href: announcementStoryHref(story.bodyMarkdown),
          })),
        };
      }
    }
  }

  if (args.html) {
    return {
      featured: { title: "From CopilotKit", bodyMarkdown: "" },
      stories: [],
      fallbackHtml: args.html,
    };
  }

  return undefined;
}

/** Build the Home briefing from data the Inspector already has. */
export function buildHomeModel(input: HomeBriefingInput): HomeModel {
  const metadataAction =
    input.metadata.threadsFooterAction ?? input.metadata.lockedAction;
  const action = metadataAction
    ? homeHeroActionFromMetadata({
        kind: metadataAction.kind,
        url: metadataAction.url,
      })
    : undefined;

  const identity = input.metadata.identity;
  const projectLinked = Boolean(identity);
  const usage = usageFromMetadata(input.metadata);

  return {
    firstOpen: input.firstOpen,
    unreadAnnouncement: input.unreadAnnouncement,
    hero: heroForState({
      projectLinked,
      action,
      connectUrl: input.intelligenceSignupUrl,
    }),
    projectLinked,
    project: identity
      ? {
          organizationName: identity.organizationName,
          projectName: identity.projectName,
          planLabel: input.metadata.plan?.label,
          license: input.metadata.licenseState,
          usage,
        }
      : input.metadata.plan
        ? {
            organizationName: "Not linked",
            projectName: "This runtime is not linked to a project",
            planLabel: input.metadata.plan.label,
            license: input.metadata.licenseState,
            usage,
          }
        : undefined,
    runtime: {
      url: input.runtimeUrl,
      version: input.runtimeVersion,
      mode: input.runtimeMode,
      agentCount: input.agentNames.length,
      available: Boolean(input.runtimeVersion),
    },
    services: [
      {
        id: "threads",
        label: "Threads",
        on: input.threadsAvailable,
        url: input.runtimeUrl,
        docsUrl: SERVICE_DOCS_URL.threads,
      },
      {
        id: "memory",
        label: "Memory",
        on: input.memoriesOn,
        docsUrl: SERVICE_DOCS_URL.memory,
      },
      {
        id: "a2ui",
        label: "A2UI",
        on: input.a2uiOn,
        docsUrl: SERVICE_DOCS_URL.a2ui,
      },
      {
        id: "open-gen-ui",
        label: "Open Gen UI",
        on: input.openGenUiOn,
        docsUrl: SERVICE_DOCS_URL["open-gen-ui"],
      },
      {
        id: "suggestions",
        label: "Suggestions",
        on: input.suggestionsOn,
        docsUrl: SERVICE_DOCS_URL.suggestions,
      },
      {
        id: "audio",
        label: "Audio",
        on: input.audioOn,
        docsUrl: SERVICE_DOCS_URL.audio,
      },
      {
        id: "websocket",
        label: "Websocket",
        on: Boolean(input.websocketUrl),
        url: input.websocketUrl,
        docsUrl: SERVICE_DOCS_URL.websocket,
      },
    ],
    news: newsFromAnnouncement({
      markdown: input.announcementMarkdown,
      html: input.announcementHtml ?? undefined,
    }),
  };
}
