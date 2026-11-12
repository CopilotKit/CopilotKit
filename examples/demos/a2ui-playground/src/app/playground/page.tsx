import { SiteHeader } from "@/components/site/site-header";
import { PlaygroundClient } from "./playground-client";

export const metadata = {
  title: "A2UI Playground by CopilotKit",
  description:
    "Ask an agent for an interface and watch it write A2UI 1.0, one line per component, then draw the same answer with CopilotKit's standard catalog, ChatCN or your own components.",
};

type Search = Record<string, string | string[] | undefined>;

/** `?embed=1` (any value but 0 or false): the playground in an iframe. */
const isEmbed = (v: Search[string]) => {
  const s = Array.isArray(v) ? v[0] : v;
  return s !== undefined && s !== "0" && s !== "false";
};

/** The query as it came, without `embed`: the link out of an embed opens the same page. */
function queryWithoutEmbed(params: Search) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === "embed" || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, one);
  }
  return q.toString();
}

/**
 * The workbench: the site's front door, at / and at /playground. It fills the window: the conversation scrolls
 * above its pinned composer. With `?embed=1` (CopilotKit's site and docs show it in an iframe) the header is
 * the embed's own and the side panel starts collapsed; `?theme=` and `?ds=` work alongside it. Reading the
 * query renders the page per request, so an embed never flashes the full site's nav.
 */
export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const embed = isEmbed(params.embed);
  return (
    <div
      className="pg-root wb-page flex h-[100dvh] flex-col overflow-hidden"
      data-embed={embed || undefined}
    >
      <SiteHeader
        active="playground"
        embed={embed ? { query: queryWithoutEmbed(params) } : undefined}
      />
      <PlaygroundClient embed={embed} />
    </div>
  );
}
