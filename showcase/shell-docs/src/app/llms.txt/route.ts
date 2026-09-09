// `/llms.txt` — curated Markdown decision index for the documentation.
//
// Follows the llmstxt convention (https://llmstxt.org / Fumadocs's
// `llms()` helper): a single H1 + description + nested list of page
// links. LLM crawlers pull this once and walk the selected per-page `.md`
// endpoints from the URLs listed here. The exhaustive route inventory remains
// available from `/llms-full.txt`.
//
// We don't use Fumadocs's `llms(source)` helper because this site builds its
// sidebar from a hand-rolled meta.json walker (`docs-render`), not the loader
// API. This route intentionally uses a small explicit list instead of walking
// that complete route table.
//
// Re-render cadence: the policy changes only with a deploy. We set
// `revalidate = false` so the Next.js route-handler cache holds the response
// indefinitely on the server side. The `Cache-Control` header below is the
// separate per-response CDN/browser hint.

import { NextResponse } from "next/server";
import {
  CURATED_FRAMEWORK_PAGES,
  CURATED_LLM_PAGES,
} from "@/lib/curated-llm-pages";
import { renderLlmsIndex } from "@/lib/llm-text";
import { getBaseUrl } from "@/lib/sitemap-helpers";

export const revalidate = false;

export function GET(): NextResponse {
  const body = renderLlmsIndex(
    CURATED_LLM_PAGES,
    getBaseUrl(),
    CURATED_FRAMEWORK_PAGES,
  );
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
