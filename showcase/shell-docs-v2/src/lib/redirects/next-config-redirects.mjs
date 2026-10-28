// @ts-check
// next.config `redirects()` table, ported from showcase/shell-docs/next.config.ts
// (the app serving docs.copilotkit.ai before v2). Every legacy URL those
// rules redirect must keep redirecting the same way here: same source, same
// destination, same status (`permanent: true` = 308, `permanent: false` =
// 307, `statusCode: 301` = 301), same order.
//
// Imported ONLY by next.config.mjs. Keep it free of app imports and don't
// import it from runtime code: shell-docs found that a module shared between
// next.config and the app pulls the config into route NFT traces.
//
// Next runs these before src/proxy.ts, which carries the second legacy table
// (seo-redirects.ts). Same layering as shell-docs (config, then middleware).
//
// Deliberate difference from shell-docs: v2 serves its own `/docs/*`,
// `/proto/*`, `/api/*`, `/og/*` and `/llms*` routes, so a leading
// `:framework` param here can never capture those first segments (otherwise
// `/:framework/threads` would turn `/docs/threads` into `/docs/AG-UI-Streams`).

/** @typedef {import("next/dist/lib/load-custom-routes").Redirect} Redirect */

const V2_RESERVED_SEGMENTS = "(?!(?:docs|proto|api|og)(?:/|$)|llms)";
/** A leading framework segment, never one of v2's own route namespaces. */
const FRAMEWORK = `:framework(${V2_RESERVED_SEGMENTS}[^/]+)`;
/** As FRAMEWORK, also excluding `reference` (keeps `/reference/channels` canonical). */
const FRAMEWORK_NOT_REFERENCE = `:framework((?!reference)${V2_RESERVED_SEGMENTS}[^/]+)`;
/** As FRAMEWORK_NOT_REFERENCE; `intelligence` is a docs section, not a framework. */
const FRAMEWORK_NOT_REFERENCE_OR_INTELLIGENCE = `:framework((?!reference|intelligence)${V2_RESERVED_SEGMENTS}[^/]+)`;

const CHANNEL_REDIRECT_FRONTENDS = ["slack", "teams"];

const CHANNEL_REDIRECT_GUIDE_SLUGS = [
  "overview",
  "intelligence",
  "connect",
  "tools",
  "identity-and-memory",
  "rich-messages",
  "posting-jsx-as-images",
  "render-and-carousel",
  "interactive",
  "commands-and-reactions",
  "files-and-multimodality",
  "threads-and-state",
  "persistence-and-scaling",
  "history-and-transcripts",
  "deploy-and-operate",
];

// A raw Markdown request reaches redirects before any `.md` / `.mdx`
// handling. Keep suffix-specific wildcard rules first so a broad HTML rule
// cannot strip the suffix before the Markdown route receives the canonical URL.
const REDIRECT_SUFFIXES = [".md", ".mdx", ""];

/**
 * @param {string} source
 * @param {string} destination
 * @returns {Redirect[]}
 */
function permanentRedirectsWithSuffixes(source, destination) {
  return REDIRECT_SUFFIXES.map((suffix) => ({
    source: `${source}${suffix}`,
    destination: `${destination}${suffix}`,
    permanent: true,
  }));
}

const NON_REACT_DOCS_FRONTENDS = ["react-spa", "vue", "react-native"];

// ---------------------------------------------------------------------------
// AG-UI Streams overview (was `/threads`). React is the unprefixed default;
// Angular keeps its native thread guide.
// ---------------------------------------------------------------------------
/** @type {Redirect[]} */
const AG_UI_STREAMS_REDIRECTS = [
  ...["", "/built-in-agent", "/react", "/react/built-in-agent"].flatMap(
    (prefix) =>
      permanentRedirectsWithSuffixes(`${prefix}/threads`, "/AG-UI-Streams"),
  ),
  ...permanentRedirectsWithSuffixes(
    "/react/:framework/threads",
    "/:framework/AG-UI-Streams",
  ),
  ...[...NON_REACT_DOCS_FRONTENDS, "slack", "teams"].flatMap((frontend) => [
    ...permanentRedirectsWithSuffixes(
      `/${frontend}/threads`,
      `/${frontend}/AG-UI-Streams`,
    ),
    ...permanentRedirectsWithSuffixes(
      `/${frontend}/:framework/threads`,
      `/${frontend}/:framework/AG-UI-Streams`,
    ),
  ]),
  ...permanentRedirectsWithSuffixes(
    "/angular/threads",
    "/angular/guides/threads-memory-attachments-headless",
  ),
  ...permanentRedirectsWithSuffixes(
    "/angular/:framework/threads",
    "/angular/:framework/guides/threads-memory-attachments-headless",
  ),
];

// ---------------------------------------------------------------------------
// Open-JSON-UI is retired: every published HTML and raw-doc URL goes to the
// matching A2UI page in one hop.
// ---------------------------------------------------------------------------
/** @type {Redirect[]} */
const OPEN_JSON_UI_RETIREMENT_REDIRECTS = [
  ...permanentRedirectsWithSuffixes(
    "/learn/generative-ui/specs/open-json-ui",
    "/generative-ui/a2ui",
  ),
  ...permanentRedirectsWithSuffixes(
    "/generative-ui/specs/open-json-ui",
    "/generative-ui/a2ui",
  ),
  ...permanentRedirectsWithSuffixes(
    "/generative-ui/open-json-ui",
    "/generative-ui/a2ui",
  ),
  ...permanentRedirectsWithSuffixes(
    "/built-in-agent/generative-ui/open-json-ui",
    "/generative-ui/a2ui",
  ),
  ...permanentRedirectsWithSuffixes(
    "/react/generative-ui/open-json-ui",
    "/generative-ui/a2ui",
  ),
  ...permanentRedirectsWithSuffixes(
    "/react/:framework/generative-ui/open-json-ui",
    "/:framework/generative-ui/a2ui",
  ),
  ...permanentRedirectsWithSuffixes(
    "/angular/generative-ui/open-json-ui",
    "/angular/guides/a2ui",
  ),
  ...permanentRedirectsWithSuffixes(
    "/angular/:framework/generative-ui/open-json-ui",
    "/angular/:framework/guides/a2ui",
  ),
  ...NON_REACT_DOCS_FRONTENDS.flatMap((frontend) => [
    ...permanentRedirectsWithSuffixes(
      `/${frontend}/generative-ui/open-json-ui`,
      `/${frontend}/generative-ui/a2ui`,
    ),
    ...permanentRedirectsWithSuffixes(
      `/${frontend}/:framework/generative-ui/open-json-ui`,
      `/${frontend}/:framework/generative-ui/a2ui`,
    ),
  ]),
  ...permanentRedirectsWithSuffixes(
    `/${FRAMEWORK}/generative-ui/open-json-ui`,
    "/:framework/generative-ui/a2ui",
  ),
];

// ---------------------------------------------------------------------------
// Self-managed thread persistence is retired: its URLs land on the AG-UI
// Streams overview (Angular on its native threads guide).
// ---------------------------------------------------------------------------
const ANGULAR_THREADS_GUIDE = "guides/threads-memory-attachments-headless";

/** @type {Redirect[]} */
const THREADS_SELF_MANAGED_RETIREMENT_REDIRECTS = [
  ...permanentRedirectsWithSuffixes("/threads-self-managed", "/AG-UI-Streams"),
  ...permanentRedirectsWithSuffixes(
    "/built-in-agent/threads-self-managed",
    "/AG-UI-Streams",
  ),
  ...permanentRedirectsWithSuffixes(
    "/react/threads-self-managed",
    "/AG-UI-Streams",
  ),
  ...permanentRedirectsWithSuffixes(
    "/react/:framework/threads-self-managed",
    "/:framework/AG-UI-Streams",
  ),
  ...permanentRedirectsWithSuffixes(
    "/angular/threads-self-managed",
    `/angular/${ANGULAR_THREADS_GUIDE}`,
  ),
  ...permanentRedirectsWithSuffixes(
    "/angular/:framework/threads-self-managed",
    `/angular/:framework/${ANGULAR_THREADS_GUIDE}`,
  ),
  ...NON_REACT_DOCS_FRONTENDS.flatMap((frontend) => [
    ...permanentRedirectsWithSuffixes(
      `/${frontend}/threads-self-managed`,
      `/${frontend}/AG-UI-Streams`,
    ),
    ...permanentRedirectsWithSuffixes(
      `/${frontend}/:framework/threads-self-managed`,
      `/${frontend}/:framework/AG-UI-Streams`,
    ),
  ]),
  ...permanentRedirectsWithSuffixes(
    `/${FRAMEWORK}/threads-self-managed`,
    "/:framework/AG-UI-Streams",
  ),
];

// ---------------------------------------------------------------------------
// Channels (OSS-615): legacy global, scoped, generated-reference, and Bots
// URLs resolve directly to the canonical Slack/Teams guide trees.
// ---------------------------------------------------------------------------

/**
 * @param {string} legacySlug
 * @param {string} canonicalSlug
 * @param {{ collapseExplicitDefaultGuide?: boolean }} [options]
 * @returns {Redirect[]}
 */
function channelChildRedirects(legacySlug, canonicalSlug, options = {}) {
  /** @type {Redirect[]} */
  const redirects = [];
  const canonicalSuffix =
    canonicalSlug === "overview" ? "" : `/${canonicalSlug}`;

  for (const frontend of CHANNEL_REDIRECT_FRONTENDS) {
    redirects.push(
      ...permanentRedirectsWithSuffixes(
        `/${frontend}/built-in-agent/channels/${legacySlug}`,
        `/${frontend}${canonicalSuffix}`,
      ),
    );

    if (options.collapseExplicitDefaultGuide) {
      redirects.push(
        ...permanentRedirectsWithSuffixes(
          `/${frontend}/built-in-agent/${legacySlug}`,
          `/${frontend}${canonicalSuffix}`,
        ),
      );
    }

    redirects.push(
      ...permanentRedirectsWithSuffixes(
        `/${frontend}/:framework/channels/${legacySlug}`,
        `/${frontend}/:framework${canonicalSuffix}`,
      ),
      ...permanentRedirectsWithSuffixes(
        `/${frontend}/channels/${legacySlug}`,
        `/${frontend}${canonicalSuffix}`,
      ),
    );
  }

  redirects.push(
    ...permanentRedirectsWithSuffixes(
      `/built-in-agent/channels/${legacySlug}`,
      `/slack${canonicalSuffix}`,
    ),
    ...permanentRedirectsWithSuffixes(
      `/${FRAMEWORK_NOT_REFERENCE}/channels/${legacySlug}`,
      `/slack/:framework${canonicalSuffix}`,
    ),
    ...permanentRedirectsWithSuffixes(
      `/channels/${legacySlug}`,
      `/slack${canonicalSuffix}`,
    ),
  );

  return redirects;
}

const RETIRED_CHANNEL_GUIDES = [
  ["quickstart", "connect"],
  ["ui-library", "rich-messages"],
  ["mcp", "tools"],
  ["configuration", "intelligence"],
  ["persistence", "persistence-and-scaling"],
  ["transcripts", "history-and-transcripts"],
];

const CHANNEL_REFERENCE_PATHS = [
  ["reference/channel", "classes/Channel"],
  ["reference/thread", "classes/Thread"],
  ["reference/callbacks", "types/JSXCallbacks"],
];

/** @type {Redirect[]} */
const CHANNEL_REFERENCE_REDIRECTS = CHANNEL_REFERENCE_PATHS.flatMap(
  ([legacyPath, referencePath]) => {
    const destination = `/reference/channels/${referencePath}`;
    return [
      ...CHANNEL_REDIRECT_FRONTENDS.flatMap((frontend) => [
        ...permanentRedirectsWithSuffixes(
          `/${frontend}/${legacyPath}`,
          destination,
        ),
        ...permanentRedirectsWithSuffixes(
          `/${frontend}/built-in-agent/${legacyPath}`,
          destination,
        ),
        ...permanentRedirectsWithSuffixes(
          `/${frontend}/:framework/${legacyPath}`,
          destination,
        ),
        ...permanentRedirectsWithSuffixes(
          `/${frontend}/channels/${legacyPath}`,
          destination,
        ),
        ...permanentRedirectsWithSuffixes(
          `/${frontend}/built-in-agent/channels/${legacyPath}`,
          destination,
        ),
        ...permanentRedirectsWithSuffixes(
          `/${frontend}/:framework/channels/${legacyPath}`,
          destination,
        ),
      ]),
      ...permanentRedirectsWithSuffixes(`/channels/${legacyPath}`, destination),
      ...permanentRedirectsWithSuffixes(
        `/built-in-agent/channels/${legacyPath}`,
        destination,
      ),
      ...permanentRedirectsWithSuffixes(
        `/${FRAMEWORK_NOT_REFERENCE}/channels/${legacyPath}`,
        destination,
      ),
    ];
  },
);

/** @type {Redirect[]} */
const RENAMED_CHANNEL_REFERENCE_REDIRECTS = [
  ["functions/createBot", "functions/createChannel"],
  ["functions/defineBotCommand", "functions/defineChannelCommand"],
  ["functions/defineBotTool", "functions/defineChannelTool"],
  ["types/BotNode", "types/ChannelNode"],
].flatMap(([legacyPath, canonicalPath]) =>
  permanentRedirectsWithSuffixes(
    `/reference/channels/${legacyPath}`,
    `/reference/channels/${canonicalPath}`,
  ),
);

/** @type {Redirect[]} */
const DIRECT_PROVIDER_REFERENCE_REDIRECTS = ["slack", "discord"].flatMap(
  (provider) => [
    ...permanentRedirectsWithSuffixes(
      `/reference/channels/${provider}`,
      "/reference/channels/sdk/direct-adapters",
    ),
    ...permanentRedirectsWithSuffixes(
      `/reference/channels/${provider}/:path*`,
      "/reference/channels/sdk/direct-adapters",
    ),
  ],
);

const MAINTAINED_CHANNEL_GUIDE_REDIRECTS = CHANNEL_REDIRECT_GUIDE_SLUGS.flatMap(
  (slug) =>
    channelChildRedirects(slug, slug, { collapseExplicitDefaultGuide: true }),
);

const RETIRED_CHANNEL_GUIDE_REDIRECTS = RETIRED_CHANNEL_GUIDES.flatMap(
  ([legacySlug, canonicalSlug]) =>
    channelChildRedirects(legacySlug, canonicalSlug),
);

const RETIRED_INTERACTIVE_SUBGUIDE_REDIRECTS = channelChildRedirects(
  "interactive/:path+",
  "interactive",
);

/** @type {Redirect[]} */
const BOTS_REDIRECTS = [
  ...CHANNEL_REDIRECT_GUIDE_SLUGS.flatMap((slug) =>
    permanentRedirectsWithSuffixes(
      `/bots/${slug}`,
      slug === "overview" ? "/slack" : `/slack/${slug}`,
    ),
  ),
  ...RETIRED_CHANNEL_GUIDES.flatMap(([legacySlug, canonicalSlug]) =>
    permanentRedirectsWithSuffixes(
      `/bots/${legacySlug}`,
      `/slack/${canonicalSlug}`,
    ),
  ),
  ...permanentRedirectsWithSuffixes(
    "/bots/interactive/:path+",
    "/slack/interactive",
  ),
  ...permanentRedirectsWithSuffixes("/reference/bot", "/reference/channels"),
  ...permanentRedirectsWithSuffixes(
    "/reference/bot/:path*",
    "/reference/channels",
  ),
  ...permanentRedirectsWithSuffixes("/bots", "/slack"),
  ...permanentRedirectsWithSuffixes("/bots/:path*", "/slack"),
];

/** @type {Redirect[]} */
const CHANNEL_ROOT_REDIRECTS = [
  ...CHANNEL_REDIRECT_FRONTENDS.flatMap((frontend) => [
    ...permanentRedirectsWithSuffixes(
      `/${frontend}/quickstart`,
      `/${frontend}/connect`,
    ),
    ...permanentRedirectsWithSuffixes(
      `/${frontend}/:framework/quickstart`,
      `/${frontend}/:framework/connect`,
    ),
    ...permanentRedirectsWithSuffixes(`/${frontend}/overview`, `/${frontend}`),
    ...permanentRedirectsWithSuffixes(
      `/${frontend}/:framework/overview`,
      `/${frontend}/:framework`,
    ),
    ...permanentRedirectsWithSuffixes(
      `/${frontend}/built-in-agent/channels`,
      `/${frontend}`,
    ),
    ...permanentRedirectsWithSuffixes(
      `/${frontend}/built-in-agent`,
      `/${frontend}`,
    ),
    ...permanentRedirectsWithSuffixes(
      `/${frontend}/:framework/channels`,
      `/${frontend}/:framework`,
    ),
    ...permanentRedirectsWithSuffixes(`/${frontend}/channels`, `/${frontend}`),
  ]),
  ...permanentRedirectsWithSuffixes("/built-in-agent/channels", "/slack"),
  // Without the `intelligence` exclusion, `/intelligence/channels` would
  // become `/slack/intelligence`.
  ...permanentRedirectsWithSuffixes(
    `/${FRAMEWORK_NOT_REFERENCE_OR_INTELLIGENCE}/channels`,
    "/slack/:framework",
  ),
  ...permanentRedirectsWithSuffixes("/channels", "/slack"),
];

/** @type {Redirect[]} */
const CHANNEL_PLATFORM_REDIRECTS = [
  ...permanentRedirectsWithSuffixes("/channels/platforms/slack", "/slack"),
  ...permanentRedirectsWithSuffixes("/channels/platforms/teams", "/teams"),
  ...permanentRedirectsWithSuffixes("/channels/platforms", "/slack"),
  ...permanentRedirectsWithSuffixes("/channels/platforms/:path*", "/slack"),
  ...permanentRedirectsWithSuffixes("/whatsapp", "/slack"),
  ...permanentRedirectsWithSuffixes("/whatsapp/:path*", "/slack"),
  ...permanentRedirectsWithSuffixes("/frontends/whatsapp", "/slack"),
];

/** @type {Redirect[]} */
const CHANNEL_REDIRECTS = [
  // Provider-scoped reference routes move back to the global SDK reference.
  // Keep these before the broad legacy framework roots, which also exclude
  // the reserved `reference` segment so `/reference/channels` stays canonical.
  ...CHANNEL_REFERENCE_REDIRECTS,
  ...RENAMED_CHANNEL_REFERENCE_REDIRECTS,
  ...DIRECT_PROVIDER_REFERENCE_REDIRECTS,
  ...MAINTAINED_CHANNEL_GUIDE_REDIRECTS,
  ...RETIRED_CHANNEL_GUIDE_REDIRECTS,
  ...RETIRED_INTERACTIVE_SUBGUIDE_REDIRECTS,
  ...BOTS_REDIRECTS,
  ...CHANNEL_PLATFORM_REDIRECTS,
  ...permanentRedirectsWithSuffixes("/slack/using-these-docs", "/slack"),
  ...permanentRedirectsWithSuffixes("/teams/using-these-docs", "/teams"),
  // Broad legacy roots last. Child redirects are intentionally exact: an
  // unknown `/channels/*` child must not become an accidental guide URL.
  ...CHANNEL_ROOT_REDIRECTS,
];

// ---------------------------------------------------------------------------
// Retired AG-UI mirror (`/ag-ui/*`) hands its search equity to
// docs.ag-ui.com with a 301. Slugs match upstream 1:1 except the paths listed
// in AG_UI_MIRROR_EXCEPTIONS, which sit ABOVE the wildcard so they win.
// Upstream serves `.md` but not `.mdx`, so both suffixes collapse onto `.md`.
// ---------------------------------------------------------------------------
const AG_UI_DOCS_ORIGIN = "https://docs.ag-ui.com";

/**
 * @param {string} mirrorPath
 * @param {string} upstreamPath
 * @returns {Redirect[]}
 */
function agUiMirrorRedirects(mirrorPath, upstreamPath) {
  return [
    {
      source: `/ag-ui${mirrorPath}.mdx`,
      destination: `${AG_UI_DOCS_ORIGIN}${upstreamPath}.md`,
      statusCode: 301,
    },
    {
      source: `/ag-ui${mirrorPath}.md`,
      destination: `${AG_UI_DOCS_ORIGIN}${upstreamPath}.md`,
      statusCode: 301,
    },
    {
      source: `/ag-ui${mirrorPath}`,
      destination: `${AG_UI_DOCS_ORIGIN}${upstreamPath}`,
      statusCode: 301,
    },
  ];
}

const AG_UI_MIRROR_EXCEPTIONS = [
  // Both drafts graduated into the Concepts section upstream.
  ["/drafts/interrupts", "/concepts/interrupts"],
  ["/drafts/multimodal-messages", "/concepts/messages"],
  // The Dart SDK kept every page except its client overview.
  ["/sdk/dart/client/overview", "/sdk/dart/overview"],
  // Upstream reduced the Rust SDK to a single overview page.
  ["/sdk/rust/client/agent-trait", "/sdk/rust/overview"],
  ["/sdk/rust/client/http-agent", "/sdk/rust/overview"],
  ["/sdk/rust/client/subscriber", "/sdk/rust/overview"],
  ["/sdk/rust/core/events", "/sdk/rust/overview"],
  ["/sdk/rust/core/overview", "/sdk/rust/overview"],
  ["/sdk/rust/core/types", "/sdk/rust/overview"],
];

/** @type {Redirect[]} */
const AG_UI_MIRROR_REDIRECTS = [
  ...AG_UI_MIRROR_EXCEPTIONS.flatMap(([mirrorPath, upstreamPath]) =>
    agUiMirrorRedirects(mirrorPath, upstreamPath),
  ),
  // The mirror root rendered the AG-UI introduction page.
  ...agUiMirrorRedirects("", "/introduction"),
  // Everything else keeps its slug upstream.
  {
    source: "/ag-ui/:path*.mdx",
    destination: `${AG_UI_DOCS_ORIGIN}/:path*.md`,
    statusCode: 301,
  },
  {
    source: "/ag-ui/:path*.md",
    destination: `${AG_UI_DOCS_ORIGIN}/:path*.md`,
    statusCode: 301,
  },
  {
    source: "/ag-ui/:path*",
    destination: `${AG_UI_DOCS_ORIGIN}/:path*`,
    statusCode: 301,
  },
];

// ---------------------------------------------------------------------------
// One-off renames, the retired /unselected, /built-in-agent and /learn
// trees, and the Concepts restructure. Order matters: specific entries
// precede the catch-alls they would otherwise lose to.
// ---------------------------------------------------------------------------
/** @type {Redirect[]} */
const PAGE_REDIRECTS = [
  // Built-in Agent is the default framework, served at the root.
  { source: "/built-in-agent", destination: "/", permanent: true },
  // The BIA index.mdx would duplicate the home page as `/index`.
  { source: "/index", destination: "/", permanent: true },
  { source: "/frontend-actions", destination: "/frontend-tools", permanent: true },
  {
    source: "/troubleshooting/migrate-to-v2",
    destination: "/migrate/v2",
    permanent: true,
  },
  {
    source: "/troubleshooting/migrate-to-1.10.X",
    destination: "/migrate/1.10.X",
    permanent: true,
  },
  {
    source: "/troubleshooting/migrate-to-1.8.2",
    destination: "/migrate/1.8.2",
    permanent: true,
  },
  {
    source: "/concepts/oss-vs-cloud",
    destination: "/concepts/oss-vs-enterprise",
    permanent: true,
  },

  // /unselected/* retired: BIA content now lives at the root. Per-path
  // entries map moves and slug renames; the catch-all below routes the rest.
  { source: "/unselected", destination: "/", permanent: true },
  { source: "/unselected/quickstart", destination: "/quickstart", permanent: true },
  {
    source: "/unselected/advanced-configuration",
    destination: "/advanced-configuration",
    permanent: true,
  },
  { source: "/unselected/mcp-servers", destination: "/mcp-servers", permanent: true },
  {
    source: "/unselected/model-selection",
    destination: "/model-selection",
    permanent: true,
  },
  { source: "/unselected/server-tools", destination: "/server-tools", permanent: true },
  { source: "/unselected/shared-state", destination: "/shared-state", permanent: true },
  {
    source: "/unselected/generative-ui/mcp-apps",
    destination: "/generative-ui/mcp-apps",
    permanent: true,
  },
  { source: "/unselected/ag-ui", destination: "/backend/ag-ui", permanent: true },
  {
    source: "/unselected/copilot-runtime",
    destination: "/backend/copilot-runtime",
    permanent: true,
  },
  // custom-agent consolidated onto /backend/custom-agent.
  {
    source: "/built-in-agent/custom-agent",
    destination: "/backend/custom-agent",
    permanent: true,
  },
  {
    source: "/integrations/built-in-agent/custom-agent",
    destination: "/backend/custom-agent",
    permanent: true,
  },
  { source: "/custom-agent", destination: "/backend/custom-agent", permanent: true },

  // /built-in-agent/<page> moved to /<page>. Specific entries first, then
  // the catch-all that strips the prefix.
  { source: "/built-in-agent/ag-ui", destination: "/backend/ag-ui", permanent: true },
  // Tutorials are retired; framework-scoped tutorial URLs go to quickstart.
  {
    source: "/built-in-agent/tutorials/:path*",
    destination: "/quickstart",
    permanent: true,
  },
  // `premium/` was renamed `intelligence/` (OSS-1078); one hop for BIA.
  {
    source: "/built-in-agent/premium",
    destination: "/intelligence/overview",
    permanent: true,
  },
  {
    source: "/built-in-agent/premium/:path*",
    destination: "/intelligence/:path*",
    permanent: true,
  },
  { source: "/built-in-agent/:path*", destination: "/:path*", permanent: true },
  {
    source: "/unselected/troubleshooting/migrate-to-v2",
    destination: "/migrate/v2",
    permanent: true,
  },
  {
    source: "/unselected/troubleshooting/migrate-to-1.10.X",
    destination: "/migrate/1.10.X",
    permanent: true,
  },
  {
    source: "/unselected/troubleshooting/migrate-to-1.8.2",
    destination: "/migrate/1.8.2",
    permanent: true,
  },
  {
    source: "/unselected/tutorials/:path*",
    destination: "/tutorials/:path*",
    permanent: true,
  },
  // LangGraph-specific page parked in unselected/; land on generic HITL.
  {
    source: "/unselected/generative-ui/your-components/interrupt-based",
    destination: "/human-in-the-loop",
    permanent: true,
  },
  {
    source: "/unselected/agent-app-context",
    destination: "/agent-app-context",
    permanent: true,
  },
  // Slug renames (mirror SUBPATH_RENAMES in seo-redirects.ts); before the
  // catch-all so the rename wins.
  {
    source: "/unselected/agentic-chat-ui",
    destination: "/prebuilt-components",
    permanent: true,
  },
  {
    source: "/unselected/use-agent-hook",
    destination: "/programmatic-control",
    permanent: true,
  },
  {
    source: "/unselected/frontend-actions",
    destination: "/frontend-tools",
    permanent: true,
  },
  {
    source: "/unselected/vibe-coding-mcp",
    destination: "/build-with-agents",
    permanent: true,
  },
  {
    source: "/unselected/generative-ui/agentic",
    destination: "/generative-ui/your-components/display-only",
    permanent: true,
  },
  {
    source: "/unselected/generative-ui/backend-tools",
    destination: "/generative-ui/tool-rendering",
    permanent: true,
  },
  {
    source: "/unselected/generative-ui/frontend-tools",
    destination: "/frontend-tools",
    permanent: true,
  },
  {
    source: "/unselected/generative-ui/render-only",
    destination: "/generative-ui/your-components/display-only",
    permanent: true,
  },
  {
    source: "/unselected/custom-look-and-feel/bring-your-own-components",
    destination: "/custom-look-and-feel/slots",
    permanent: true,
  },
  {
    source: "/unselected/custom-look-and-feel/customize-built-in-ui-components",
    destination: "/custom-look-and-feel/slots",
    permanent: true,
  },
  {
    source: "/unselected/custom-look-and-feel/markdown-rendering",
    destination: "/custom-look-and-feel/slots",
    permanent: true,
  },
  // The /guides tree no longer exists anywhere.
  { source: "/unselected/guide", destination: "/", permanent: true },
  { source: "/unselected/mcp", destination: "/build-with-agents", permanent: true },
  { source: "/unselected/:path*", destination: "/:path*", permanent: true },

  // /learn/* retired: explanation pages promoted into Concepts, What's New
  // became its own section.
  { source: "/learn", destination: "/concepts/architecture", permanent: true },
  {
    source: "/learn/architecture",
    destination: "/concepts/architecture",
    permanent: true,
  },
  ...permanentRedirectsWithSuffixes(
    "/learn/threads",
    "/intelligence/threads-explained",
  ),
  {
    source: "/learn/intelligence-platform",
    destination: "/intelligence/intelligence-platform",
    permanent: true,
  },
  {
    source: "/learn/agentic-protocols",
    destination: "/agentic-protocols",
    permanent: true,
  },
  {
    source: "/learn/ag-ui-protocol",
    destination: "/agentic-protocols/ag-ui",
    permanent: true,
  },
  {
    source: "/learn/a2a-protocol",
    destination: "/agentic-protocols/a2a",
    permanent: true,
  },
  {
    source: "/learn/connect-mcp-servers",
    destination: "/agentic-protocols/mcp",
    permanent: true,
  },
  {
    source: "/learn/generative-ui",
    destination: "/concepts/generative-ui-overview",
    permanent: true,
  },
  {
    source: "/learn/generative-ui/specs/a2ui",
    destination: "/generative-ui/a2ui",
    permanent: true,
  },
  {
    source: "/learn/generative-ui/specs/mcp-apps",
    destination: "/generative-ui/mcp-apps",
    permanent: true,
  },
  {
    source: "/learn/generative-ui/specs",
    destination: "/concepts/generative-ui-overview",
    permanent: true,
  },
  {
    source: "/learn/tutorials/multi-conversation-chat",
    destination: "/",
    permanent: true,
  },
  {
    source: "/learn/whats-new/:path*",
    destination: "/whats-new/:path*",
    permanent: true,
  },
  { source: "/learn/whats-new", destination: "/whats-new", permanent: true },

  // Concepts restructure: protocol pages moved to /agentic-protocols/,
  // Intelligence + Threads explanations to /intelligence/.
  {
    source: "/concepts/agentic-protocols",
    destination: "/agentic-protocols",
    permanent: true,
  },
  {
    source: "/concepts/ag-ui-protocol",
    destination: "/agentic-protocols/ag-ui",
    permanent: true,
  },
  {
    source: "/concepts/mcp-servers",
    destination: "/agentic-protocols/mcp",
    permanent: true,
  },
  {
    source: "/concepts/a2a-protocol",
    destination: "/agentic-protocols/a2a",
    permanent: true,
  },
  {
    source: "/concepts/intelligence-platform",
    destination: "/intelligence/intelligence-platform",
    permanent: true,
  },
  ...permanentRedirectsWithSuffixes(
    "/concepts/threads",
    "/intelligence/threads-explained",
  ),
  // Keep the Concepts/Learn rules above more specific than this rename.
  ...permanentRedirectsWithSuffixes(
    `/${FRAMEWORK}/threads`,
    "/:framework/AG-UI-Streams",
  ),
  {
    source: "/concepts/three-types-of-gen-ui",
    destination: "/concepts/generative-ui-overview",
    permanent: true,
  },

  // Stale pages hidden pre-launch: 307, the URLs may come back.
  { source: "/tutorials/:path*", destination: "/", permanent: false },
  { source: "/coding-agent-setup", destination: "/coding-agents", permanent: false },
  {
    source: "/copilot-suggestions",
    destination: "/reference/v2/hooks/useSuggestions",
    permanent: true,
  },
  // v1 Python SDK class renamed upstream (LangGraphAgent -> LangGraphAGUIAgent).
  ...permanentRedirectsWithSuffixes(
    "/reference/v1/sdk/python/LangGraphAgent",
    "/reference/v1/sdk/python/LangGraphAGUIAgent",
  ),
  // 307: the new home is recent and may move again.
  {
    source: "/ag-ui-middleware",
    destination: "/agentic-protocols/ag-ui-middleware",
    permanent: false,
  },
  // No bare redirects for `/generative-ui/your-components/*`: BIA authors real
  // pages there, and framework-scoped variants render directly.
];

/** Same order as shell-docs' `redirects()`; first match wins. */
export const nextConfigRedirects = [
  ...AG_UI_STREAMS_REDIRECTS,
  ...OPEN_JSON_UI_RETIREMENT_REDIRECTS,
  ...THREADS_SELF_MANAGED_RETIREMENT_REDIRECTS,
  ...CHANNEL_REDIRECTS,
  ...AG_UI_MIRROR_REDIRECTS,
  ...PAGE_REDIRECTS,
];
