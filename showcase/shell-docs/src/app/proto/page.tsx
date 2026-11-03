import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { CopilotKitLogo } from "@/components/copilotkit-logo";
import { VARIANTS } from "@/proto/meta";

export const metadata: Metadata = {
  title: "Picker prototypes",
  robots: { index: false },
};

export default function Prototypes() {
  return (
    <main className="mx-auto flex w-full max-w-[72rem] flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-4">
        <Link href="/docs/ideas" className="w-fit">
          <CopilotKitLogo className="h-[22px] w-auto" />
        </Link>
        <h1 className="text-[2.25rem] leading-[1.15] font-semibold tracking-[-0.025em]">
          Picker prototypes
        </h1>
        <p className="max-w-[44rem] text-lg text-fd-muted-foreground">
          The three combinations from the picker ideas, plus a home-first take
          on Fumadocs' Home Layout. Each is a working docs site with sample
          pages: agent frameworks have their own URLs, the frontend switches
          inside the page, and Intelligence has its own section.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {VARIANTS.map((v) => (
          <Link
            key={v.id}
            href={v.entry}
            className="group flex flex-col gap-4 rounded-2xl border bg-fd-card p-6 transition-colors hover:bg-fd-accent"
          >
            <span className="text-sm text-fd-muted-foreground">{v.from}</span>
            <span className="text-xl font-semibold tracking-[-0.015em]">
              {v.name}
            </span>
            <span className="text-sm text-fd-muted-foreground">
              {v.summary}
            </span>
            <ul className="flex flex-1 flex-col gap-2 border-t pt-4 text-sm">
              {v.ideas.map((idea) => (
                <li key={idea} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-fd-primary"
                  />
                  {idea}
                </li>
              ))}
            </ul>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fd-primary">
              Open
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
