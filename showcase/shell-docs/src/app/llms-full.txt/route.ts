// `/llms-full.txt` — every documentation page concatenated into a
// single Markdown blob, with each page rendered through
// `renderPageToLlmText()` so `<Snippet />` tags are inlined as fenced
// code blocks (otherwise the body would be useless to an LLM that
// can't execute MDX).
//
// Pages are separated by an H2-rule header so a crawler can split the
// file back into per-page chunks; this matches the convention used by
// Fumadocs's reference site and `llmstxt.org` examples.
//
// This endpoint is intentionally slow (renders every MDX page on each
// request). The dev server is fine; in production behind a CDN the
// `Cache-Control` header below lets the response sit on the edge.

import { NextResponse } from "next/server";
import { getAllLlmPages, renderPageToLlmText } from "@/lib/llm-text";
import { getBaseUrl } from "@/lib/sitemap-helpers";

export const revalidate = false;

export function GET(): NextResponse {
  const baseUrl = getBaseUrl();
  const pages = getAllLlmPages();
  const chunks: string[] = [];

  // Top matter — short site description so the LLM has context before
  // it dives into individual pages.
  chunks.push("# CopilotKit Docs (Full)\n");
  chunks.push(
    "> Concatenated documentation for CopilotKit — the frontend framework for AI agents.",
  );
  chunks.push(
    "> Each section below is one page; the source URL is in the H2 header.\n",
  );

  for (const page of pages) {
    const body = renderPageToLlmText(page);
    if (!body) continue;
    const url = `${baseUrl}/${page.url}`;
    chunks.push(`---\n\n## Source: ${url}\n`);
    chunks.push(body);
  }

  return new NextResponse(chunks.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
