import type { Metadata } from "next";
import Link from "next/link";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/spacious/page";

// What a URL the docs don't serve renders, with a 404: the catch-all page
// calls `notFound()` for anything that isn't a live page, so a typo or a
// retired URL can't be indexed as a thin page.

export const metadata: Metadata = {
  title: "Page not found",
  description: "The page you're looking for doesn't exist.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <DocsPage toc={[]}>
      <DocsTitle className="text-[2.25rem] leading-[1.1] font-medium md:text-[2.5rem] tracking-[-0.03em] text-balance">
        This page doesn&apos;t exist
      </DocsTitle>
      <DocsDescription className="mb-0">
        The link you followed may be out of date, or the page may have moved.
      </DocsDescription>
      <DocsBody>
        <p>
          Start from the <Link href="/">docs home</Link>, search the docs, or
          browse the <Link href="/reference">API reference</Link>.
        </p>
      </DocsBody>
    </DocsPage>
  );
}
