import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";

export const metadata = { title: "Page not found | A2UI Playground" };

/** Any URL with no page, and any notFound() that no closer segment handles. */
export default function NotFound() {
  return (
    <div className="pg-root min-h-[100dvh] bg-black">
      <SiteHeader />
      <main className="landing-container pb-24 pt-20">
        <p className="font-mono text-[13px] text-muted-foreground">404</p>
        <h1 className="mt-3 text-[36px] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[44px]">This page does not exist</h1>
        <p className="mt-5 max-w-[56ch] text-[16px] leading-relaxed text-muted-foreground">
          The link may be old, or the address may have a typo. Try one of these instead.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/playground" className="inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-[14px] font-medium text-background transition-opacity hover:opacity-90">
            Open the playground <ArrowRight className="size-4" />
          </Link>
          <Link href="/components" className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-[14px] font-medium transition-colors hover:bg-white/[0.04]">
            Browse the components
          </Link>
          <Link href="/" className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-[14px] font-medium transition-colors hover:bg-white/[0.04]">
            Go to the home page
          </Link>
        </div>
      </main>
    </div>
  );
}
