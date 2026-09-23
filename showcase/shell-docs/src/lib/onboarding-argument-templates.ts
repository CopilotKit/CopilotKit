/**
 * The argument sentences the copied prompt composes, and their version.
 *
 * `website#594` versions the hosted document, so every run records which
 * revision of *that* text it fetched. It cannot see this half. The copied text
 * is the URL sentence plus argument prose composed client-side — the wizard
 * appends up to five sentences, page actions two, the Channels prompt one — and
 * editing any of it was invisible to every measurement (PE-255).
 *
 * These are the single source of truth for that prose. Each producer fills a
 * template from here rather than carrying its own literal, so the version below
 * cannot drift from the sentences actually copied. A hash of a literal that
 * lives somewhere else is worse than no hash: it reports a wording nobody was
 * served.
 *
 * Values stay unbound. Hashing a rendered sentence would make every copy its
 * own cohort and group nothing.
 */

import { PRODUCTION_DOCS_ORIGIN } from "@/lib/production-docs-origin";

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
  // `framework` and `frontend` are the wizard's: there the developer picked
  // both, so "I use" repeats their answer. A docs page is only what they were
  // reading, so page prompts state the source and let research find the stack
  // (PE-309).
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
  // What the page is about, as a hint for a folder with no project yet. It
  // describes the page and claims nothing about the developer's stack.
  pageTopicFramework: " The page covers the <framework> agent framework.",
  pageTopicFrameworkFrontend:
    " The page covers the <framework> agent framework with <frontend>.",
  pageTopicFrontend: " The page covers the <frontend> frontend.",
  pageSource: " I started from this CopilotKit docs page: <url>.",
} as const satisfies Readonly<Record<string, string>>;

/**
 * The revision of the argument prose above, emitted beside `prompt_version`.
 *
 * Twelve hex characters of SHA-256 over every template in key order, pinned
 * here rather than computed. Browsers have no synchronous SHA-256, and a hash
 * computed at runtime would cost every copy a round of async crypto to report
 * a value that only changes when this file does.
 *
 * `onboarding-argument-templates.test.ts` recomputes it in Node and fails when
 * it disagrees, so editing a sentence without bumping this is a red test rather
 * than a silent measurement gap.
 */
export const ONBOARDING_ARGUMENT_VERSION = "63f13e3aad0e";

/**
 * The wording behind that version, emitted beside it.
 *
 * Serialised exactly as the hash consumes it -- `key:template` per line, keys
 * sorted -- so the text verifies its own version rather than merely
 * accompanying it.
 *
 * Emitted rather than kept in a manifest: at 650 bytes on events running about
 * 120 a day, the manifest saved roughly 25 MB a year and cost a dependency
 * across three repositories. It also could not describe wording served from a
 * deploy no repository state matches. Measured before choosing (PE-255).
 */
export const ONBOARDING_ARGUMENT_TEXT = Object.keys(ARGUMENT_TEMPLATES)
  .sort()
  .map(
    (key) =>
      `${key}:${ARGUMENT_TEMPLATES[key as keyof typeof ARGUMENT_TEMPLATES]}`,
  )
  .join("\n");

/**
 * The source sentence for a docs page, from the `.mdx` URL the page tools use.
 *
 * Names the page a reader saw, not its raw `.mdx` text, and always on the
 * production origin: a local or preview host in a copied prompt points the
 * coding agent at a server it cannot reach (PE-309). The graph still reads the
 * path, because a Slack or Teams page routes the run to Channels.
 */
export function pageSourceSentence(markdownUrl: string): string {
  const path = markdownUrl.replace(/\.mdx$/, "").replace(/\/+$/, "");
  return fillArgumentTemplate(ARGUMENT_TEMPLATES.pageSource, {
    url: `${PRODUCTION_DOCS_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`,
  });
}
