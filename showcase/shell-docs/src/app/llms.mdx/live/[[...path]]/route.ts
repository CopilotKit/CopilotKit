import { resolveLivePage } from "@/lib/live-docs";
import { renderLivePageMarkdown } from "@/lib/llms/page-markdown";
import { channelMarkdownResponse } from "@/lib/early-access/markdown";

// One live docs page as Markdown. `src/proxy.ts` rewrites `<path>.md`,
// `<path>.mdx`, and `Accept: text/markdown` requests for a live URL here,
// the way shell-docs' next.config rewrote them onto its `llms-mdx` route.
//
// Telemetry (`docs.llm_text_fetched`) lives in the proxy, which sees the
// request under its public path; don't capture here as well.

export async function GET(
  _req: Request,
  { params }: RouteContext<"/llms.mdx/live/[[...path]]">,
) {
  const { path = [] } = await params;
  // An early-access channel's landing page (/whatsapp), or a redirect to it
  // from a path under it (/whatsapp/quickstart).
  const channel = channelMarkdownResponse(path);
  if (channel) return channel;
  const live = resolveLivePage(path);
  if (!live) return new Response("Not found", { status: 404 });

  const body = await renderLivePageMarkdown(live, `/${path.join("/")}`);
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
