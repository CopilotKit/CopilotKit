import { renderLlmsIndex } from "@/lib/llms/llms-index";
import { getBaseUrl } from "@/lib/seo/base-url";

// `/llms.txt`: shell-docs' curated Markdown decision index (llmstxt.org
// shape). Agents read it first and follow its links to each page's `.md`;
// `/llms-full.txt` has every page.
//
// Telemetry (`docs.llm_text_fetched`) lives in `src/proxy.ts`: this response
// is cached until the next deploy, so a capture here would fire once.

export const revalidate = false;

export function GET() {
  return new Response(renderLlmsIndex(getBaseUrl()), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
