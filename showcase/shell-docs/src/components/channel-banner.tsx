import { Banner } from "fumadocs-ui/components/banner";
import { isVnextChannel } from "@/lib/docs-channel";
import { PRODUCTION_DOCS_ORIGIN } from "@/lib/seo/base-url";

/**
 * The banner on every page of the next major release's docs
 * (DOCS_CHANNEL=vnext). It sends readers of the current release to the live
 * docs. Its `id` gives it a close button; Fumadocs remembers the dismissal in
 * localStorage. The live docs render nothing here.
 *
 * Fumadocs' Banner sticks to the top and sets --fd-banner-height, which the
 * layouts read to sit under it. It is taller than its 3rem default, so the
 * text fits in three lines on a phone.
 */
export function ChannelBanner() {
  if (!isVnextChannel) return null;
  return (
    <Banner
      id="docs-2-rc"
      height="3.5rem"
      className="ps-10 pe-12 max-sm:text-xs"
    >
      <p>
        You are reading the docs for CopilotKit 2.0 (release candidate). For the
        current 1.x docs, go to{" "}
        <a
          href={PRODUCTION_DOCS_ORIGIN}
          className="underline underline-offset-4"
        >
          docs.copilotkit.ai
        </a>
        .
      </p>
    </Banner>
  );
}
