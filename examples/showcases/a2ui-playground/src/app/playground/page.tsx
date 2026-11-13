import { SiteHeader } from "@/components/site/site-header";
import { PlaygroundClient } from "./playground-client";
import { SITE_URL } from "@/lib/site";

const title = "A2UI Playground: Live A2UI Examples by CopilotKit";
const description =
  "Try A2UI in your browser: ask an agent for an interface, watch it write A2UI 1.0, and explore A2UI examples drawn with CopilotKit, ChatCN or your own UI.";

/** Written for searches like "A2UI playground" and "A2UI examples". / and /playground are one page, so both name open.bot/a2ui as canonical. */
export const metadata = {
  title,
  description,
  alternates: { canonical: SITE_URL },
  openGraph: {
    title,
    description,
    url: SITE_URL,
    siteName: "A2UI Playground",
    type: "website",
  },
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
