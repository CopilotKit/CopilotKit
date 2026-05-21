// `/llms.txt` — Markdown index of every documentation page.
//
// Follows the llmstxt convention (https://llmstxt.org / Fumadocs's
// `llms()` helper): a single H1 + description + nested list of page
// links. LLM crawlers pull this once and walk the per-page `.md`
// endpoints from the URLs listed here.
//
// We don't use Fumadocs's `llms(source)` helper because this site
// builds its sidebar from a hand-rolled meta.json walker (`docs-render`),
// not the loader API. The shared `getAllLlmPages()` enumerator yields
// the same set the sitemap emits — bare docs + per-framework override
// pages + reference + ag-ui — so the index stays in sync with the
// actual route table.
//
// Re-render cadence: file-based content is read on every request in dev
// (so authoring edits show up immediately). In production, page lookups
// hit the module-level caches in `docs-render`, so a single request only
// re-walks the filesystem on cache misses. No explicit `revalidate`
// directive — Next defaults to dynamic for route handlers.

import { NextResponse } from "next/server";
import { getAllLlmPages, renderLlmsIndex } from "@/lib/llm-text";
import { getBaseUrl } from "@/lib/sitemap-helpers";

export const revalidate = false;

export function GET(): NextResponse {
  const pages = getAllLlmPages();
  const body = renderLlmsIndex(pages, getBaseUrl());
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
