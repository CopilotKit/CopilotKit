/**
 * The agent-facing half of the docs: routes whose body is raw text for an LLM
 * reader rather than a rendered page.
 *
 * A fetch of one of these never loads the page, so the client-side PostHog
 * snippet never runs for it. They are reported from `middleware.ts` instead,
 * which is the only code of ours that every such request reaches — `llms.txt`
 * and `llms-full.txt` both set `revalidate = false`, so their route handlers do
 * not re-run per request at all.
 */
export type LlmTextSurface =
  /** `/llms.txt` — the llmstxt.org index of every page. */
  | "llms_index"
  /** `/llms-full.txt` — every page concatenated into one blob. */
  | "llms_full"
  /** `<path>.md` / `<path>.mdx` — one page as raw Markdown. */
  | "page_markdown";

const LLMS_INDEX_PATH = "/llms.txt";
const LLMS_FULL_PATH = "/llms-full.txt";

// `next.config.ts` rewrites both suffixes onto the same route handler
// (`app/llms-mdx/[[...slug]]/route.ts`), so they are one surface here too.
const MARKDOWN_SUFFIXES = [".md", ".mdx"] as const;

/**
 * Name the raw text surface a request is for.
 *
 * @param pathname - The request path, before `next.config.ts` rewrites it.
 * @returns The surface, or `null` for an ordinary docs page.
 */
export function resolveLlmTextSurface(pathname: string): LlmTextSurface | null {
  if (pathname === LLMS_INDEX_PATH) return "llms_index";
  if (pathname === LLMS_FULL_PATH) return "llms_full";
  if (MARKDOWN_SUFFIXES.some((suffix) => pathname.endsWith(suffix))) {
    return "page_markdown";
  }
  return null;
}
