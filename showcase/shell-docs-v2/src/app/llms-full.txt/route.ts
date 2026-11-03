import { llmsFullEntries } from "@/lib/llms/live-inventory";
import { mapLimit } from "@/lib/llms/map-limit";
import { renderLivePageMarkdown } from "@/lib/llms/page-markdown";
import { getBaseUrl } from "@/lib/seo/base-url";

// `/llms-full.txt`: every live docs page in one Markdown file, shaped like
// shell-docs': a short preamble, then each page under a `## Source: <url>`
// header so a crawler can split it back into pages. Rendering every page is
// slow, so the response is cached until the next deploy.
//
// Telemetry (`docs.llm_text_fetched`) lives in `src/proxy.ts`: a capture here
// would fire once per deploy.

export const revalidate = false;

export async function GET() {
  const baseUrl = getBaseUrl();
  const pages = await mapLimit(llmsFullEntries(), 8, async ({ url, live }) => {
    try {
      return `---\n\n## Source: ${baseUrl}${url}\n\n${await renderLivePageMarkdown(live, url)}`;
    } catch (error) {
      // One broken page shouldn't take the whole file down.
      console.error(`[llms-full.txt] failed to render ${url}`, error);
      return null;
    }
  });

  const body = [
    "# CopilotKit Docs (Full)\n",
    "> Concatenated documentation for CopilotKit — the frontend framework for AI agents.",
    "> Each section below is one page; the source URL is in the H2 header.\n",
    ...pages.filter((page): page is string => page !== null),
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
