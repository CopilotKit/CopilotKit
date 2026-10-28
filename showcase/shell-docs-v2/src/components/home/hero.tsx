import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { CopyPrompt } from "./copy-prompt";

export function Hero({
  title,
  accent,
  children,
  href = "/docs/quickstart",
  action = "Quickstart",
}: {
  title: string;
  accent: string;
  children: ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <section className="not-prose flex flex-col items-start gap-6 pt-4 pb-2 md:pt-8">
      <h1 className="text-[2.5rem] leading-[1.1] font-medium tracking-[-0.03em] text-balance md:text-[3.5rem] md:leading-[1.08]">
        {title}
        <span className="block">{accent}</span>
      </h1>
      <div className="max-w-[38rem] text-lg leading-relaxed text-fd-muted-foreground md:text-xl">
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={href}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-fd-foreground px-5 font-medium text-fd-background transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background focus-visible:outline-none"
        >
          {action}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        <CopyPrompt />
      </div>
    </section>
  );
}
