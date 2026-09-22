/**
 * The argument sentences the copied prompt composes, and their version.
 *
 * `website#594` versions the hosted document, so every run records which
 * revision of *that* text it fetched. It cannot see this half. The copied text
 * is the URL sentence plus argument prose composed client-side — the wizard
 * appends five sentences, page actions append three, the hero button one — and
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
  framework: " I use the <name> agent framework (`<slug>`).",
  frontend: " I use the <name> frontend (`<slug>`).",
  wizardChannelsFrontend:
    " I want to connect my agent to <name> using CopilotKit Channels. Follow the channel setup documentation at https://docs.copilotkit.ai/<id>.",
  wizardProjectExisting:
    " I already have an existing project and want CopilotKit added to it.",
  wizardProjectNew: " I am starting a brand new project.",
  wizardAgentExisting:
    " I already have a <name> agent. Connect that existing agent without replacing it.",
  wizardAgentNew: " I need a new <name> agent. Create it as part of the setup.",
  wizardFeatures: " I also want these CopilotKit features set up: <titles>.",
  pageSource: " I copied this prompt from <url>.",
  pageTask:
    " My goal for this quickstart is: <task> Follow the linked guide for this framework and frontend.",
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
export const ONBOARDING_ARGUMENT_VERSION = "90b0c15f555f";
