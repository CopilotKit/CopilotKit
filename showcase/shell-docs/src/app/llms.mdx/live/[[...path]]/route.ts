import { resolveLivePage } from "@/lib/live-docs";
import { renderLivePageMarkdown } from "@/lib/llms/page-markdown";
import { earlyAccessChannel } from "@/lib/early-access/channels";
import { channelPageMarkdown } from "@/lib/early-access/markdown";

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
  // An early-access channel's landing page (/whatsapp).
  const channel = path.length === 1 ? earlyAccessChannel(path[0]) : undefined;
  if (channel) {
    return new Response(channelPageMarkdown(channel.id), {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  }
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
