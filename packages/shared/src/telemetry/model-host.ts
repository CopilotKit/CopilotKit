// Which endpoint the runtime sends completions to, as a closed vocabulary.
//
// The AI SDK's provider label cannot answer this. `createOpenAI` stamps
// `openai.responses` on every model it builds, whether the base URL points at
// api.openai.com, Azure, OpenRouter or a laptop running Ollama — and Azure's
// own migration guide tells customers to use exactly that client. So the
// provider field reports the wire protocol, and the host reports the vendor.
//
// Only the classification travels. A base URL like
// `myresource.openai.azure.com` carries the customer's Azure resource name,
// which identifies them, so the raw host must never reach telemetry. That is
// why this returns a member of a fixed list rather than anything derived from
// the input.

/**
 * Every value `classifyModelHost` can return.
 *
 * `other` means a host we observed and did not recognize: a gateway, a proxy,
 * or a vendor we have no rule for. `unknown` means we never saw a host at all,
 * which is the case when a caller hands us an already-built LanguageModel.
 * The two are not interchangeable — one is an unrecognized answer, the other
 * is a missing one, and they need different follow-up.
 */
export const MODEL_HOST_CLASSES = [
  "openai",
  "azure",
  "openrouter",
  "anthropic",
  "google",
  "vertex",
  "bedrock",
  "groq",
  "unify",
  "minimax",
  "local",
  "other",
  "unknown",
] as const;

export type ModelHostClass = (typeof MODEL_HOST_CLASSES)[number];

/**
 * Host suffixes mapped to their vendor.
 *
 * Matched on label boundaries, never as substrings, so
 * `myresource.openai.azure.com.attacker.test` does not read as Azure.
 */
const HOST_SUFFIXES: ReadonlyArray<readonly [string, ModelHostClass]> = [
  // Azure exposes the same models under three host families: the classic
  // Azure OpenAI host, the Foundry Models host, and the general Cognitive
  // Services host. All three are Azure for our purposes.
  ["openai.azure.com", "azure"],
  ["services.ai.azure.com", "azure"],
  ["cognitiveservices.azure.com", "azure"],
  // API Management fronting an Azure OpenAI deployment, a common enterprise
  // pattern. Reported as azure because that is what sits behind it.
  ["azure-api.net", "azure"],

  ["api.openai.com", "openai"],
  ["openrouter.ai", "openrouter"],
  ["api.anthropic.com", "anthropic"],
  ["generativelanguage.googleapis.com", "google"],
  // Vertex regional hosts are `<region>-aiplatform.googleapis.com`, which is
  // not a suffix of a single label, so both spellings are listed.
  ["aiplatform.googleapis.com", "vertex"],
  ["api.groq.com", "groq"],
  ["api.unify.ai", "unify"],
  ["api.minimax.io", "minimax"],
  ["api.minimaxi.com", "minimax"],
];

/** Suffixes that mean the model runs on the same machine or private network. */
const LOCAL_SUFFIXES = ["localhost", "local", "internal", "docker.internal"];

/** Matches `<region>-aiplatform.googleapis.com` and the Bedrock regional hosts. */
const REGIONAL_HOST_PATTERNS: ReadonlyArray<readonly [RegExp, ModelHostClass]> =
  [
    [/^[a-z0-9-]+-aiplatform\.googleapis\.com$/, "vertex"],
    [/^bedrock[a-z0-9.-]*\.[a-z0-9-]+\.amazonaws\.com$/, "bedrock"],
  ];

/** True when `host` equals `suffix` or sits directly beneath it. */
function matchesSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

/** True for loopback, unspecified, and RFC 1918 private addresses. */
function isPrivateAddress(host: string): boolean {
  if (host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") {
    return true;
  }
  // 127.0.0.0/8 is entirely loopback.
  if (host.startsWith("127.")) return true;
  // 10.0.0.0/8 and 192.168.0.0/16.
  if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
  // 172.16.0.0/12 is 172.16 through 172.31 only. 172.32 is public, so the
  // second octet is range-checked rather than prefix-matched.
  const privateClassB = /^172\.(\d{1,3})\./.exec(host);
  if (privateClassB) {
    const secondOctet = Number(privateClassB[1]);
    return secondOctet >= 16 && secondOctet <= 31;
  }
  return false;
}

/**
 * Reduce a model endpoint to one of {@link MODEL_HOST_CLASSES}.
 *
 * @param baseUrl The endpoint the provider was configured with. Absent when
 *   the provider was left on its own default, which is why `providerDefault`
 *   exists: "no base URL, provider is openai" means api.openai.com.
 * @param providerDefault What to report when no base URL was supplied. Callers
 *   that genuinely cannot observe a host — a pre-built LanguageModel handed in
 *   by the developer — leave this alone and get `unknown`.
 */
export function classifyModelHost(
  baseUrl?: string | null,
  providerDefault: ModelHostClass = "unknown",
): ModelHostClass {
  const trimmed = baseUrl?.trim();
  if (!trimmed) {
    return providerDefault;
  }

  let host: string;
  try {
    // `hostname` drops the port, the path, the query and any credentials, so
    // nothing but the host can survive into the return value below.
    host = new URL(trimmed).hostname.toLowerCase();
  } catch {
    // We were given something and could not read it. That is a different fact
    // from having been given nothing, so it does not fall back to the default.
    return "other";
  }

  // IPv6 hostnames arrive bracketed from the URL parser.
  host = host.replace(/^\[|\]$/g, "");

  if (!host) return "other";

  if (isPrivateAddress(host)) return "local";
  for (const suffix of LOCAL_SUFFIXES) {
    if (matchesSuffix(host, suffix)) return "local";
  }

  for (const [suffix, hostClass] of HOST_SUFFIXES) {
    if (matchesSuffix(host, suffix)) return hostClass;
  }

  for (const [pattern, hostClass] of REGIONAL_HOST_PATTERNS) {
    if (pattern.test(host)) return hostClass;
  }

  return "other";
}
