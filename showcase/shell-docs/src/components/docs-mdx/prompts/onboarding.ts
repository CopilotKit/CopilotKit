// The coding-agent prompts the docs copy, ported verbatim from shell-docs
// (src/lib/intelligence-onboarding-prompt.ts, onboarding-argument-templates.ts,
// page-topic-sentence.ts, intelligence-onboarding-{framework,frontend}.ts,
// channels-onboarding-prompt.ts, prompt-guidance.ts and the *-setup-prompt.ts
// files). The copied text must stay byte-identical to shell-docs, the
// Intelligence app and the Inspector, so change them together.
//
// Pure and client-safe: no server imports.

/** The framework whose docs are served at the root (`/quickstart`). */
export const ROOT_FRAMEWORK = "built-in-agent";

/** The canonical docs origin named in copied prompts. */
export const PRODUCTION_DOCS_ORIGIN = "https://docs.copilotkit.ai";

/** Where the hosted prompt documents live (the apex host is deliberate). */
export const ONBOARDING_PROMPT_ORIGIN = "https://copilotkit.ai";

const RUN_ID_PLACEHOLDER = "<run-id>";

export const INTELLIGENCE_ONBOARDING_EVENTS = {
  promptCopied: "docs.intelligence_onboarding_prompt_copied",
  actionClicked: "docs.intelligence_onboarding_prompt_action_clicked",
} as const;

/** The one-sentence onboarding prompt shared with Intelligence and Inspector. */
export const INTELLIGENCE_ONBOARDING_PROMPT = `Read ${ONBOARDING_PROMPT_ORIGIN}/onboarding-prompts/${RUN_ID_PLACEHOLDER} and help me get set up.`;

const RUN_ID_LENGTH = 12;

/** Mint the telemetry identifier shared by the docs CTA and the CLI run. */
export function createOnboardingRunId(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID().replaceAll("-", "").slice(0, RUN_ID_LENGTH);
  }
  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(RUN_ID_LENGTH / 2));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  }
  let id = "";
  while (id.length < RUN_ID_LENGTH) {
    id += Math.floor(Math.random() * 16).toString(16);
  }
  return id.slice(0, RUN_ID_LENGTH);
}

/** Bind one run id into the canonical prompt. */
export function createIntelligenceOnboardingPrompt(runId: string): string {
  return INTELLIGENCE_ONBOARDING_PROMPT.replace(RUN_ID_PLACEHOLDER, runId);
}

/** Feature outcomes a docs guide asks the CLI prompt graph for. */
export type FeatureOnboardingIntent = "add-learning" | "add-rich-threads";

/**
 * The prompt a feature guide's card copies. With a run id the link is the
 * prompt; without one (static Markdown) it keeps the CLI command.
 */
export function createFeatureSetupPrompt(
  intent: FeatureOnboardingIntent,
  runId?: string,
): string {
  const featureContext =
    intent === "add-rich-threads"
      ? "Set up AG-UI streams, formerly known as Rich Threads, while keeping my framework threads and existing SDK APIs. "
      : "";
  if (runId === undefined) {
    return (
      featureContext +
      "Help me set this up in my CopilotKit app. Run this command and follow " +
      "the instructions:\n\nnpx --yes copilotkit@latest onboard start " +
      `--intent ${intent}` +
      "\n\nIf it requires a CopilotKit CLI session check, you have permission " +
      "to run it. Never reveal credentials."
    );
  }
  return `${featureContext}Read ${ONBOARDING_PROMPT_ORIGIN}/onboarding-prompts/${runId}?intent=${intent} and help me set this up.`;
}

export const RICH_THREADS_SETUP_PROMPT =
  createFeatureSetupPrompt("add-rich-threads");

export const LEARNING_SETUP_PROMPT = createFeatureSetupPrompt("add-learning");

/** Memory has no dedicated CLI intent; use the canonical setup guide. */
export const MEMORY_SETUP_PROMPT =
  "Help me set up long-term User Memories in my existing CopilotKit app. " +
  "Read https://docs.copilotkit.ai/intelligence/memories and follow its setup " +
  "instructions. Inspect my app and deployment, confirm memory entitlement " +
  "and the required configuration, then implement and verify saving and " +
  "recalling a memory for the signed-in user. Never reveal credentials.";

export const WEBMCP_SETUP_PROMPT =
  "Set up WebMCP in this project using https://docs.copilotkit.ai/webmcp. First inspect the app and extend its existing CopilotKit setup if present; do not add a backend agent solely for WebMCP. If I haven’t specified a tool, ask what I want to expose. If I don’t have one in mind, add a small, read-only demo tool that fits the app. Finish by verifying that a compatible browser can discover and call it.";

// ---------------------------------------------------------------------------
// Argument sentences appended to the onboarding prompt
// ---------------------------------------------------------------------------

/** Fills `<token>` placeholders in an argument template. */
export function fillArgumentTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return Object.entries(values).reduce(
    (filled, [token, value]) => filled.replaceAll(`<${token}>`, value),
    template,
  );
}

export const ARGUMENT_TEMPLATES = {
  framework: " I use the <name> agent framework.",
  frontend: " I use the <name> frontend.",
  wizardChannelsFrontend:
    " I want to connect my agent to <name> using CopilotKit Channels. Follow the channel setup documentation at https://docs.copilotkit.ai/<id>.",
  wizardProjectExisting:
    " I already have an existing project and want CopilotKit added to it.",
  wizardProjectNew: " I am starting a brand new project.",
  wizardAgentExisting:
    " I already have a <name> agent. Connect that existing agent without replacing it.",
  wizardAgentNew: " I need a new <name> agent. Create it as part of the setup.",
  wizardFeatures: " I also want these CopilotKit features set up: <titles>.",
  pageTopicFramework: " The page covers the <framework> agent framework.",
  pageTopicFrameworkFrontend:
    " The page covers the <framework> agent framework with <frontend>.",
  pageTopicFrontend: " The page covers the <frontend> frontend.",
  pageSource: " I started from this CopilotKit docs page: <url>.",
} as const satisfies Readonly<Record<string, string>>;

/** SHA-256 (12 hex) over every template above, pinned as in shell-docs. */
export const ONBOARDING_ARGUMENT_VERSION = "63f13e3aad0e";

/** The wording behind that version, `key:template` per line, keys sorted. */
export const ONBOARDING_ARGUMENT_TEXT = Object.keys(ARGUMENT_TEMPLATES)
  .sort()
  .map(
    (key) =>
      `${key}:${ARGUMENT_TEMPLATES[key as keyof typeof ARGUMENT_TEMPLATES]}`,
  )
  .join("\n");

/** The source sentence for a docs page, always on the production origin. */
export function pageSourceSentence(pagePath: string): string {
  const path = pagePath.replace(/\.mdx?$/, "").replace(/\/+$/, "");
  return fillArgumentTemplate(ARGUMENT_TEMPLATES.pageSource, {
    url: `${PRODUCTION_DOCS_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`,
  });
}

/** Agent-framework slugs the CLI's onboarding graph accepts. */
const ONBOARDING_AGENT_FRAMEWORKS = new Set([
  "ag2",
  "agno",
  "built-in",
  "claude-sdk-python",
  "claude-sdk-typescript",
  "crewai-flows",
  "deep-agents",
  "google-adk",
  "langgraph-fastapi",
  "langgraph-python",
  "langgraph-typescript",
  "llamaindex",
  "mastra",
  "ms-agent-dotnet",
  "ms-agent-harness-dotnet",
  "ms-agent-python",
  "pydantic-ai",
  "strands-python",
  "strands-typescript",
]);

const DOCS_SLUG_RENAMES: Record<string, string> = {
  "built-in-agent": "built-in",
  "crewai-crews": "crewai-flows",
  deepagents: "deep-agents",
  strands: "strands-python",
};

/** A docs framework slug as the onboarding graph spells it, if it has one. */
export function onboardingFrameworkSlug(docsSlug: string): string | undefined {
  const candidate = DOCS_SLUG_RENAMES[docsSlug] ?? docsSlug;
  return ONBOARDING_AGENT_FRAMEWORKS.has(candidate) ? candidate : undefined;
}

/** Frontend slugs the CLI's onboarding graph accepts. */
const ONBOARDING_FRONTENDS = new Set([
  "angular",
  "nextjs",
  "react-native",
  "react-spa",
  "vue",
]);

const DOCS_FRONTEND_RENAMES: Record<string, string> = { react: "nextjs" };

/** A docs frontend id as the onboarding graph spells it, if it has one. */
export function onboardingFrontendSlug(docsId: string): string | undefined {
  const candidate = DOCS_FRONTEND_RENAMES[docsId] ?? docsId;
  return ONBOARDING_FRONTENDS.has(candidate) ? candidate : undefined;
}

/** The graph's `nextjs` node is the Next.js setup, so name it that. */
export function onboardingFrontendName(
  graphSlug: string,
  displayName: string,
): string {
  return graphSlug === "nextjs" ? "Next.js" : displayName;
}

/** Display names the prompt template needs trimmed (shell-docs' PROMPT_DISPLAY_NAMES). */
export const PROMPT_DISPLAY_NAMES: Record<string, string> = {
  "built-in-agent": "Built-in",
};

/** Docs frontend display names (showcase/shared/frontend-registry.json). */
export const FRONTEND_NAMES: Record<string, string> = {
  react: "React",
  "react-spa": "React SPA",
  vue: "Vue",
  "react-native": "React Native",
  angular: "Angular",
  slack: "Slack",
  teams: "Teams",
};

/** What a docs page covers, as a hint; "" when the graph knows neither. */
export function pageTopicSentence(
  framework: { slug: string; name: string } | undefined,
  frontend: { id: string; name: string } | undefined,
): string {
  const knownFramework =
    framework && onboardingFrameworkSlug(framework.slug) !== undefined
      ? framework.name
      : undefined;
  const frontendSlug = frontend
    ? onboardingFrontendSlug(frontend.id)
    : undefined;
  const knownFrontend =
    frontend && frontendSlug !== undefined
      ? onboardingFrontendName(frontendSlug, frontend.name)
      : undefined;
  if (knownFramework && knownFrontend) {
    return fillArgumentTemplate(ARGUMENT_TEMPLATES.pageTopicFrameworkFrontend, {
      framework: knownFramework,
      frontend: knownFrontend,
    });
  }
  if (knownFramework) {
    return fillArgumentTemplate(ARGUMENT_TEMPLATES.pageTopicFramework, {
      framework: knownFramework,
    });
  }
  if (knownFrontend) {
    return fillArgumentTemplate(ARGUMENT_TEMPLATES.pageTopicFrontend, {
      frontend: knownFrontend,
    });
  }
  return "";
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const CHANNEL_ONBOARDING_IDS = ["slack", "teams"] as const;
export type ChannelOnboardingId = (typeof CHANNEL_ONBOARDING_IDS)[number];

export function isChannelOnboardingId(
  id: string | undefined,
): id is ChannelOnboardingId {
  return (
    id !== undefined &&
    (CHANNEL_ONBOARDING_IDS as readonly string[]).includes(id)
  );
}

/** Channel pages copy the same small onboarding prompt as the website CTA. */
export function createChannelsOnboardingPrompt(runId: string): string {
  return createIntelligenceOnboardingPrompt(runId);
}

export const CHANNELS_ACTIVATION_EVENTS = {
  promptCopied: "docs.channels_activation_prompt_copied",
  viewed: "docs.channels_activation_viewed",
} as const;

export const CHANNELS_ACTIVATION_SURFACES = {
  docsChannelsOverview: "docs_channels_overview",
} as const;

// ---------------------------------------------------------------------------
// The line under every prompt pill
// ---------------------------------------------------------------------------

export const PROMPT_DESTINATION_HINT =
  "Open your coding agent in your project's folder, or in an empty folder for a new app.";

export const PROMPT_PHONE_HINT =
  "This runs in a coding agent on your computer.";
