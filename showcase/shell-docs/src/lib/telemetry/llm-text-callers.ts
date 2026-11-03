/**
 * Who fetched the agent-facing raw text surface — `/llms.txt`,
 * `/llms-full.txt`, and every `<path>.md` / `<path>.mdx` page.
 *
 * These routes exist for LLM readers, so they attract training crawlers as
 * readily as they attract a coding agent working for a real developer. An
 * unclassified hit count is close to useless: the whole question is which of
 * those two a given fetch was.
 *
 * This is a first cut, deliberately paired with the raw user agent on every
 * event. Classification of a public endpoint is never finished: new agents ship
 * constantly, and the honest failure mode is that many coding agents fetch with
 * a bare `undici`/`node` user agent and are indistinguishable from any other
 * script. Keeping `$raw_user_agent` on the event means a bucket that turns out
 * to be wrong can be re-cut retroactively, without waiting for a redeploy.
 *
 * PORTED from `src/lib/channels-guide-callers.ts` in the `CopilotKit/website`
 * repository, which classifies the hosted Channels guide the same way. The two
 * live in different deployments and cannot share a module, so the rule table
 * below is kept in the same order and shape as its counterpart: a diff between
 * the two files should show renames and nothing else.
 */
export type LlmTextCallerClass =
  | "coding_agent"
  | "ai_user_fetch"
  | "ai_crawler"
  | "search_crawler"
  | "script"
  | "browser"
  | "unknown";

type CallerRule = {
  /** Lowercased substring to look for in the user agent. */
  token: string;
  class: LlmTextCallerClass;
  /** Normalised product name, so counting doesn't require parsing raw UAs. */
  agent: string;
};

// Order is load-bearing. Nearly every crawler also claims "Mozilla/5.0", and
// several coding agents embed a browser-shaped UA, so the specific tokens have
// to be tested before the generic browser/script shapes below.
const CALLER_RULES: readonly CallerRule[] = [
  // Coding agents — a developer's tool acting on their behalf. This is the
  // bucket that means the raw Markdown surface is doing its job.
  { token: "claude-code", class: "coding_agent", agent: "claude_code" },
  { token: "cursor", class: "coding_agent", agent: "cursor" },
  { token: "windsurf", class: "coding_agent", agent: "windsurf" },
  { token: "codeium", class: "coding_agent", agent: "codeium" },
  { token: "aider", class: "coding_agent", agent: "aider" },
  { token: "cline", class: "coding_agent", agent: "cline" },
  { token: "roocode", class: "coding_agent", agent: "roo_code" },
  { token: "devin", class: "coding_agent", agent: "devin" },
  { token: "codex", class: "coding_agent", agent: "codex" },
  { token: "opencode", class: "coding_agent", agent: "opencode" },
  { token: "goose", class: "coding_agent", agent: "goose" },
  { token: "zed", class: "coding_agent", agent: "zed" },
  { token: "jetbrains", class: "coding_agent", agent: "jetbrains" },
  { token: "replit", class: "coding_agent", agent: "replit" },
  // Deliberately the hyphenated product token and not a bare "copilot": that
  // substring also appears in Microsoft assistant/crawler agents, and this rule
  // sits ahead of the crawler block, so a loose match would promote a crawler
  // into the one class this metric exists to count. Erring toward undercounting.
  { token: "github-copilot", class: "coding_agent", agent: "github_copilot" },

  // An assistant fetching because a human asked it to, right now. Genuine
  // intent, but not necessarily a coding agent that will write any code.
  { token: "chatgpt-user", class: "ai_user_fetch", agent: "chatgpt" },
  { token: "claude-user", class: "ai_user_fetch", agent: "claude" },
  { token: "perplexity-user", class: "ai_user_fetch", agent: "perplexity" },
  { token: "gemini-user", class: "ai_user_fetch", agent: "gemini" },
  { token: "mistralai-user", class: "ai_user_fetch", agent: "mistral" },
  { token: "duckassistbot", class: "ai_user_fetch", agent: "duckassist" },

  // Training / retrieval crawlers. Real traffic, zero activation signal.
  { token: "gptbot", class: "ai_crawler", agent: "gptbot" },
  { token: "oai-searchbot", class: "ai_crawler", agent: "oai_searchbot" },
  { token: "claudebot", class: "ai_crawler", agent: "claudebot" },
  { token: "claude-searchbot", class: "ai_crawler", agent: "claude_searchbot" },
  { token: "anthropic-ai", class: "ai_crawler", agent: "anthropic_ai" },
  { token: "ccbot", class: "ai_crawler", agent: "ccbot" },
  { token: "google-extended", class: "ai_crawler", agent: "google_extended" },
  { token: "perplexitybot", class: "ai_crawler", agent: "perplexitybot" },
  { token: "bytespider", class: "ai_crawler", agent: "bytespider" },
  { token: "amazonbot", class: "ai_crawler", agent: "amazonbot" },
  {
    token: "applebot-extended",
    class: "ai_crawler",
    agent: "applebot_extended",
  },
  {
    token: "meta-externalagent",
    class: "ai_crawler",
    agent: "meta_externalagent",
  },
  { token: "facebookbot", class: "ai_crawler", agent: "facebookbot" },
  { token: "diffbot", class: "ai_crawler", agent: "diffbot" },
  { token: "omgili", class: "ai_crawler", agent: "omgili" },
  { token: "cohere-ai", class: "ai_crawler", agent: "cohere_ai" },
  { token: "youbot", class: "ai_crawler", agent: "youbot" },
  { token: "imagesiftbot", class: "ai_crawler", agent: "imagesiftbot" },
  { token: "timpibot", class: "ai_crawler", agent: "timpibot" },
  { token: "ai2bot", class: "ai_crawler", agent: "ai2bot" },

  // Conventional search / SEO indexing.
  { token: "googlebot", class: "search_crawler", agent: "googlebot" },
  { token: "bingbot", class: "search_crawler", agent: "bingbot" },
  { token: "duckduckbot", class: "search_crawler", agent: "duckduckbot" },
  { token: "baiduspider", class: "search_crawler", agent: "baiduspider" },
  { token: "yandexbot", class: "search_crawler", agent: "yandexbot" },
  { token: "ahrefsbot", class: "search_crawler", agent: "ahrefsbot" },
  { token: "semrushbot", class: "search_crawler", agent: "semrushbot" },
  { token: "applebot", class: "search_crawler", agent: "applebot" },
  { token: "slurp", class: "search_crawler", agent: "yahoo_slurp" },

  // Bare HTTP clients. A coding agent using plain `fetch` lands here too — see
  // the note above about why the raw UA travels with every event.
  { token: "curl/", class: "script", agent: "curl" },
  { token: "wget/", class: "script", agent: "wget" },
  { token: "python-requests", class: "script", agent: "python_requests" },
  { token: "python-urllib", class: "script", agent: "python_urllib" },
  { token: "aiohttp", class: "script", agent: "aiohttp" },
  { token: "httpx", class: "script", agent: "httpx" },
  { token: "node-fetch", class: "script", agent: "node_fetch" },
  { token: "undici", class: "script", agent: "undici" },
  { token: "axios", class: "script", agent: "axios" },
  { token: "go-http-client", class: "script", agent: "go_http" },
  { token: "okhttp", class: "script", agent: "okhttp" },
  { token: "postmanruntime", class: "script", agent: "postman" },
  { token: "httpie", class: "script", agent: "httpie" },
  { token: "libwww-perl", class: "script", agent: "libwww_perl" },
];

// A browser is recognised by shape rather than by listing every build: it claims
// Mozilla AND names a rendering engine. Checked only after every rule above has
// missed, because crawlers impersonate exactly this shape.
const BROWSER_ENGINE_TOKENS = [
  "chrome/",
  "safari/",
  "firefox/",
  "edg/",
  "opr/",
  "gecko/",
] as const;

export type LlmTextCaller = {
  class: LlmTextCallerClass;
  /** Normalised product name, or `"unrecognised"` when no rule matched. */
  agent: string;
};

/**
 * Classify a fetch of the raw text surface from its user agent alone.
 *
 * Intentionally total: an absent or unrecognised user agent is a real and
 * frequent case on a public file, so it gets its own bucket rather than being
 * forced into a guess.
 */
export function classifyLlmTextCaller(
  userAgent: string | null | undefined,
): LlmTextCaller {
  const ua = userAgent?.trim().toLowerCase();
  if (!ua) return { class: "unknown", agent: "absent" };

  const matched = CALLER_RULES.find((rule) => ua.includes(rule.token));
  if (matched) return { class: matched.class, agent: matched.agent };

  // "bot"/"crawler"/"spider" is the convention a well-behaved unlisted crawler
  // follows, so honour it before considering the UA browser-shaped.
  if (ua.includes("bot") || ua.includes("crawler") || ua.includes("spider")) {
    return { class: "ai_crawler", agent: "unlisted_bot" };
  }

  if (
    ua.includes("mozilla/") &&
    BROWSER_ENGINE_TOKENS.some((token) => ua.includes(token))
  ) {
    return { class: "browser", agent: "browser" };
  }

  return { class: "unknown", agent: "unrecognised" };
}

/**
 * Which classes count as "an agent actually reading our docs" is deliberately
 * NOT decided here and NOT stored on the event.
 *
 * As of writing that means `coding_agent`, `ai_user_fetch`, and `browser`, with
 * everything else read as ambient traffic against a public URL. But the honest
 * uncertainty is that a coding agent fetching with a bare `undici`/`node` user
 * agent is indistinguishable from any other script, so `script` may well belong
 * in that set once real traffic says so.
 *
 * Baking the answer into a boolean property would freeze today's guess into
 * history: revising it would only affect events captured after the deploy. Left
 * to the query, the whole backlog can be re-cut at once — the same reason the
 * raw user agent is stored alongside the classification.
 *
 *   countIf(properties.caller_class IN ('coding_agent', 'ai_user_fetch', 'browser'))
 */
