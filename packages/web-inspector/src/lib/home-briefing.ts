import type { InspectorMetadataProjection } from "./inspector-metadata.js";

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

export type HomeRuntimeConnectionState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error"
  | "unavailable";

export type HomeRuntimeHealthTone = "success" | "active" | "error" | "muted";

export type HomeServiceId =
  | "threads"
  | "memory"
  | "a2ui"
  | "open-gen-ui"
  | "suggestions"
  | "audio"
  | "websocket";

export type HomeServiceTile = {
  id: HomeServiceId;
  label: string;
  enabled: boolean;
  url?: string;
  docsUrl: string;
};

export type HomeModel = {
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
    health: {
      state: "healthy" | "checking" | "offline" | "error" | "unavailable";
      label: string;
      runtime: {
        label: string;
        tone: HomeRuntimeHealthTone;
      };
      liveUpdates: {
        label: string;
        tone: HomeRuntimeHealthTone;
      };
      lastEvent: {
        label: string;
        tone: HomeRuntimeHealthTone;
        id?: string;
        agentId?: string;
        type?: string;
        timestamp?: number;
      };
    };
  };
  services: HomeServiceTile[];
  news: {
    title: string;
    previewText: string;
    documentHtml?: string;
    empty: boolean;
  };
};

export type HomeBriefingInput = {
  intelligenceConnected: boolean;
  threadsAvailable: boolean;
  metadata: InspectorMetadataProjection;
  runtimeUrl?: string;
  runtimeConnectionState: HomeRuntimeConnectionState;
  lastRuntimeEvent?: {
    id: string;
    agentId: string;
    type: string;
    timestamp: number;
  };
  memoriesOn: boolean;
  a2uiOn: boolean;
  openGenUiOn: boolean;
  suggestionsOn: boolean;
  audioOn: boolean;
  websocketUrl?: string;
  announcementPreviewText?: string;
  announcementMarkdown?: string;
  announcementHtml?: string;
  intelligenceSignupUrl?: string;
};

const SERVICE_DOCS_URL: Record<HomeServiceId, string> = {
  threads: "https://docs.copilotkit.ai/threads",
  memory: "https://docs.copilotkit.ai/premium/intelligence-platform",
  a2ui: "https://docs.copilotkit.ai/generative-ui/a2ui",
  "open-gen-ui": "https://docs.copilotkit.ai/generative-ui/open-generative-ui",
  suggestions: "https://docs.copilotkit.ai/agentic-chat-ui",
  audio: "https://docs.copilotkit.ai/voice",
  websocket: "https://docs.copilotkit.ai/premium/intelligence-platform",
};

/** Return the Home hero button for a trusted metadata action. */
export function homeHeroActionFromMetadata(action: {
  kind: HomeHeroActionKind;
  url: string;
}): HomeHeroAction {
  if (action.kind === "manage_plan") {
    return { kind: action.kind, url: action.url, label: "Manage plan" };
  }

  if (action.kind === "renew") {
    return { kind: action.kind, url: action.url, label: "Renew plan" };
  }

  return {
    kind: action.kind,
    url: action.url,
    label: "Setup Intelligence",
  };
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
  licenseState?: InspectorMetadataProjection["licenseState"],
): HomeHeroAction | undefined {
  if (action) {
    return action;
  }

  if (connectUrl && (licenseState === "none" || licenseState === "unknown")) {
    return homeHeroActionFromMetadata({
      kind: "enable_intelligence",
      url: connectUrl,
    });
  }

  return undefined;
}

function heroForState(args: {
  connected: boolean;
  action?: HomeHeroAction;
  connectUrl?: string;
  licenseState: InspectorMetadataProjection["licenseState"];
}): HomeModel["hero"] {
  if (!args.connected) {
    const renewing = args.action?.kind === "renew";
    return {
      connection: "disconnected",
      // Not "Intelligence is not setup" — that reads as a defect in the tool,
      // and a defect gets dismissed. The heading names the product; the
      // argument for it is made by the rotating copy on Home, which changes
      // with the picture beside it.
      title: renewing ? "Renew Intelligence" : "CopilotKit Intelligence",
      // In install mode this is NOT the visible paragraph. The visible copy
      // rotates every few seconds, which would make a screen reader announce a
      // new sentence four times a loop, so the rotating text is hidden from
      // assistive tech and this one stable sentence is exposed instead. It has
      // to carry the whole chain on its own.
      body: renewing
        ? "Renew Intelligence to restore persistent Threads and Memory."
        : "Intelligence keeps every thread your users have, finds the corrections that repeat, and turns them into skills your agent reuses.",
      action: connectIntelligenceAction(
        args.action,
        args.connectUrl,
        args.licenseState,
      ),
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
  previewText?: string;
  markdown?: string;
  html?: string;
}): HomeModel["news"] {
  const markdown = args.markdown?.trim();
  if (markdown && args.html) {
    const heading = markdown.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
    return {
      title: heading || "The latest from CopilotKit",
      previewText:
        args.previewText?.trim() || announcementPreview(markdown, 160),
      documentHtml: args.html,
      empty: false,
    };
  }

  return {
    title: "You're all caught up",
    previewText: "Latest CopilotKit updates will appear here.",
    empty: true,
  };
}

function runtimeEventSignal(
  event: HomeBriefingInput["lastRuntimeEvent"],
): HomeModel["runtime"]["health"]["lastEvent"] {
  if (!event) {
    return { label: "No events yet", tone: "muted" };
  }

  const eventDetails = {
    id: event.id,
    agentId: event.agentId,
    type: event.type,
    timestamp: event.timestamp,
  };

  if (event.type === "RUN_ERROR" || event.type === "ERROR") {
    return {
      label: event.type === "RUN_ERROR" ? "Run error" : "Error",
      tone: "error",
      ...eventDetails,
    };
  }

  if (event.type === "RUN_FINISHED") {
    return {
      label: "Run completed",
      tone: "success",
      ...eventDetails,
    };
  }

  if (
    event.type.endsWith("_START") ||
    event.type.endsWith("_STARTED") ||
    event.type.endsWith("_CONTENT") ||
    event.type.endsWith("_ARGS") ||
    event.type.endsWith("_DELTA")
  ) {
    return {
      label: "Last event is in progress",
      tone: "active",
      ...eventDetails,
    };
  }

  return {
    label: "Last event received",
    tone: "success",
    ...eventDetails,
  };
}

/**
 * Whether the runtime *connection* needs attention — the single condition
 * shared by System Health and the launcher's error signal, so the two can
 * never disagree about whether the wiring is broken.
 *
 * Exactly one state counts. `disconnected` is also the initial value, so
 * counting it would raise the signal on every page load; `connecting` is a
 * normal startup step; `unavailable` means no Core is attached, which is not
 * a defect of the developer's wiring.
 *
 * Note the deliberate asymmetry with `health.state`: a failed *run* also
 * drives System Health to "Needs attention" while the connection is fine.
 * That is an event rather than a state, and it is excluded from the launcher
 * on purpose — see the launcher-signal comments in index.ts.
 */
export function runtimeConnectionNeedsAttention(
  state: HomeRuntimeConnectionState,
): boolean {
  return state === "error";
}

function runtimeHealthFromInput(
  input: HomeBriefingInput,
): HomeModel["runtime"]["health"] {
  const lastEvent = runtimeEventSignal(input.lastRuntimeEvent);

  if (input.runtimeConnectionState === "connected") {
    return {
      state: lastEvent.tone === "error" ? "error" : "healthy",
      label: lastEvent.tone === "error" ? "Needs attention" : "Healthy",
      runtime: { label: "Available", tone: "success" },
      liveUpdates: { label: "Ready", tone: "success" },
      lastEvent,
    };
  }

  if (input.runtimeConnectionState === "connecting") {
    return {
      state: "checking",
      label: "Checking",
      runtime: { label: "Checking", tone: "active" },
      liveUpdates: { label: "Connecting", tone: "active" },
      lastEvent,
    };
  }

  if (input.runtimeConnectionState === "unavailable") {
    return {
      state: "unavailable",
      label: "Unavailable",
      runtime: { label: "Unavailable", tone: "muted" },
      liveUpdates: { label: "Not attached", tone: "muted" },
      lastEvent,
    };
  }

  const needsAttention = runtimeConnectionNeedsAttention(
    input.runtimeConnectionState,
  );
  return {
    state: needsAttention ? "error" : "offline",
    label: needsAttention ? "Runtime error" : "Offline",
    runtime: { label: "Offline", tone: "error" },
    liveUpdates: {
      label: needsAttention ? "Error" : "Disconnected",
      tone: "error",
    },
    lastEvent,
  };
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
  const intelligenceConnected =
    input.metadata.licenseState === "valid" ||
    (input.metadata.licenseState === "unknown" && input.intelligenceConnected);
  const usage = usageFromMetadata(input.metadata);

  return {
    hero: heroForState({
      connected: intelligenceConnected,
      action,
      connectUrl: input.intelligenceSignupUrl,
      licenseState: input.metadata.licenseState,
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
      : input.metadata.plan || usage
        ? {
            organizationName: "Not linked",
            projectName: "This runtime is not linked to a project",
            planLabel: input.metadata.plan?.label,
            license: input.metadata.licenseState,
            usage,
          }
        : undefined,
    runtime: {
      url: input.runtimeUrl,
      health: runtimeHealthFromInput(input),
    },
    services: [
      {
        id: "threads",
        label: "Threads",
        enabled: intelligenceConnected && input.threadsAvailable,
        url: input.runtimeUrl,
        docsUrl: SERVICE_DOCS_URL.threads,
      },
      {
        id: "memory",
        label: "Memory",
        enabled: intelligenceConnected && input.memoriesOn,
        docsUrl: SERVICE_DOCS_URL.memory,
      },
      {
        id: "a2ui",
        label: "A2UI",
        enabled: input.a2uiOn,
        docsUrl: SERVICE_DOCS_URL.a2ui,
      },
      {
        id: "open-gen-ui",
        label: "Open Gen UI",
        enabled: input.openGenUiOn,
        docsUrl: SERVICE_DOCS_URL["open-gen-ui"],
      },
      {
        id: "suggestions",
        label: "Suggestions",
        enabled: input.suggestionsOn,
        docsUrl: SERVICE_DOCS_URL.suggestions,
      },
      {
        id: "audio",
        label: "Audio",
        enabled: input.audioOn,
        docsUrl: SERVICE_DOCS_URL.audio,
      },
      {
        id: "websocket",
        label: "Websocket",
        enabled: intelligenceConnected && Boolean(input.websocketUrl),
        url: input.websocketUrl,
        docsUrl: SERVICE_DOCS_URL.websocket,
      },
    ],
    news: newsFromAnnouncement({
      previewText: input.announcementPreviewText,
      markdown: input.announcementMarkdown,
      html: input.announcementHtml ?? undefined,
    }),
  };
}
