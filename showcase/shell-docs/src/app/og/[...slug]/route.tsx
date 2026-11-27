import { notFound } from "next/navigation";
import { resolveLivePage } from "@/lib/live-docs";
import { earlyAccessChannel } from "@/lib/early-access/channels";
import { EARLY_ACCESS_CHANNEL_COPY } from "@/lib/early-access/copy";
import { HOME_DESCRIPTION, HOME_TITLE } from "@/lib/seo/metadata";
import { docsOgImage } from "@/lib/seo/og-image";

// A live page's social card at `/og/<page path>/og.png`, the URL shape
// shell-docs served (`/og/mastra/frontend-tools/og.png`); `/og/og.png` is the
// home page's. Drawn on first request, then cached: there's one per scoped
// URL, too many to draw at build.

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<"/og/[...slug]">,
) {
  const { slug } = await params;
  if (slug.at(-1) !== "og.png") notFound();
  const path = slug.slice(0, -1);
  if (path.length === 0) {
    return docsOgImage({ title: HOME_TITLE, description: HOME_DESCRIPTION });
  }
  // An early-access channel's landing page, titled with the channel's name
  // as a docs page's card is with its short title: the card fits one line
  // of title, and the page title wraps into the description.
  const channel = path.length === 1 ? earlyAccessChannel(path[0]) : undefined;
  if (channel) {
    const { name, meta } = EARLY_ACCESS_CHANNEL_COPY[channel.id];
    return docsOgImage({ title: name, description: meta.description });
  }

  const live = resolveLivePage(path);
  if (!live) notFound();
  return docsOgImage({
    title: live.page.data.title,
    description: live.page.data.description,
  });
}
