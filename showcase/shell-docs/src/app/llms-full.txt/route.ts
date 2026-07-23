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
// This endpoint is intentionally slow (renders every MDX page through
// `renderPageToLlmText` on each cold request). `revalidate = false`
// caches the rendered response on the Next.js server side until the
// next deploy — without that the dev server would be fine but every
// origin hit in production (health check, monitoring probe, cold CDN
// miss) would re-walk the entire docs tree. The `Cache-Control` header
// below is the SEPARATE per-response CDN/browser hint with a shorter
// max-age so external caches refresh more frequently than server-cached
// responses.

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
