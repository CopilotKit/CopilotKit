import type { Metadata } from "next";
import Link from "next/link";
import { Download, FileJson, Plug } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { DOCS_URL, REPO_URL } from "@/components/start/links";
import { StartFlow } from "@/components/start/start-flow";
import { DesignSystemProvider } from "@/design-systems/context";
import { focusRing } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Get started · A2UI Playground",
  description:
    "Add A2UI 1.0 to your app with one prompt for your coding agent: CopilotKit's standard catalog, shadcn/ui through ChatCN, Material 3 or your own components.",
};

/** Where to go once the app answers with UI: the catalog, an agent skill, any agent. */
const NEXT: Array<{
  href: string;
  title: string;
  body: string;
  Icon: LucideIcon;
  external?: boolean;
  download?: boolean;
}> = [
  {
    href: "/catalog.json",
    title: "Catalog JSON",
    body: "A2UI 1.0 schema for other renderers.",
    Icon: FileJson,
    external: true,
  },
  {
    href: "/api/skills?format=express&download=1",
    title: "Agent skill",
    body: "For agents outside CopilotKit.",
    Icon: Download,
    download: true,
  },
  {
    href: REPO_URL ?? DOCS_URL,
    title: "Bring any agent",
    body: "AG-UI agents, Google ADK included.",
    Icon: Plug,
    external: true,
  },
];

const linkCard = `group flex h-full gap-4 rounded-xl border border-border bg-card p-5 transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-[0_2px_8px_oklch(var(--ink)/6%)] dark:bg-white/[0.025] dark:hover:shadow-none ${focusRing}`;

export default function StartPage() {
  return (
    <div className="pg-root min-h-[100dvh] dark:bg-black">
      <SiteHeader active="start" />
      <main className="mx-auto w-full max-w-[760px] px-4 pb-24 pt-16 sm:px-6 sm:pt-24">
        <header className="text-center">
          <h1 className="wb-rise text-[32px] font-semibold leading-[1.1] tracking-[-0.025em] text-balance">
            Add A2UI to your app
          </h1>
          <p
            style={{ "--rise": 1 } as React.CSSProperties}
            className="wb-rise mx-auto mt-3 max-w-[46ch] text-[15.5px] leading-relaxed text-muted-foreground text-balance"
          >
            Pick the component library your agent draws with, then set it up in
            your app.
          </p>
        </header>

        <div className="mt-16 max-[639px]:mt-12">
          <DesignSystemProvider draws={false}>
            <StartFlow />
          </DesignSystemProvider>
        </div>

        <section aria-labelledby="next" className="mt-24">
          <h2
            id="next"
            className="text-center text-[24px] font-semibold tracking-[-0.025em]"
          >
            Go further
          </h2>
          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {NEXT.map(({ Icon, ...n }) => {
              const body = (
                <>
                  <span
                    aria-hidden
                    className="grid size-10 flex-none place-items-center rounded-lg bg-black/[0.045] text-foreground/80 transition-colors group-hover:bg-foreground group-hover:text-background dark:bg-white/[0.06]"
                  >
                    <Icon className="size-[18px]" strokeWidth={1.75} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-[15px] font-medium text-foreground">
                      {n.title}
                      {n.external ? (
                        <span className="sr-only"> (opens in a new tab)</span>
                      ) : null}
                    </span>
                    <span className="text-[13.5px] leading-relaxed text-muted-foreground">
                      {n.body}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={n.title}>
                  {n.external || n.download ? (
                    <a
                      href={n.href}
                      {...(n.download
                        ? { download: true }
                        : { target: "_blank", rel: "noreferrer" })}
                      className={linkCard}
                    >
                      {body}
                    </a>
                  ) : (
                    <Link href={n.href} className={linkCard}>
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </main>
      <footer className="landing-container flex flex-wrap items-center justify-between gap-3 border-t border-border py-8 text-[12.5px] text-muted-foreground">
        <span>Built with CopilotKit, AG-UI and A2UI.</span>
        <Link
          href="/"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Back to the playground
        </Link>
      </footer>
    </div>
  );
}
