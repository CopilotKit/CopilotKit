import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Download } from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { CopyPrompt } from "@/components/start/copy-prompt";
import { DOCS_URL, REPO_URL } from "@/components/start/links";
import { DesignSystemProvider } from "@/design-systems/context";

export const metadata: Metadata = {
  title: "Get started · A2UI Playground",
  description:
    "Add A2UI 1.0 to your app with one prompt for your coding agent: CopilotKit's standard catalog, shadcn/ui through ChatCN, or your own components.",
};

/** Where to go once the prompt has run: the catalog, an agent skill, the components, any agent. */
const NEXT: Array<{
  href: string;
  label: string;
  title: string;
  body: string;
  external?: boolean;
  download?: boolean;
}> = [
  {
    href: "/catalog.json",
    label: "/catalog.json",
    title: "Catalog document",
    body: "This site's catalog in the A2UI 1.0 format: a JSON Schema for each component. A renderer for another framework, or a validator, starts here.",
    external: true,
  },
  {
    href: "/api/skills?format=express&download=1",
    label: "skills.zip",
    title: "Agent skill",
    body: "The same catalog as an agent skill, generated with Google's @a2ui/agent SDK, for an agent that writes A2UI outside CopilotKit.",
    download: true,
  },
  {
    href: "/components",
    label: "/components",
    title: "Component reference",
    body: "Every component the agent can use, with its props, a live preview and the A2UI it takes.",
  },
  {
    href: REPO_URL ?? DOCS_URL,
    label: REPO_URL ? "AG-UI and Google ADK" : "docs.copilotkit.ai",
    title: "Any agent",
    body: "The runtime fronts any agent that speaks AG-UI, Google ADK included: it adds the catalog to each request and checks every operation the agent sends back.",
    external: true,
  },
];

export default function StartPage() {
  return (
    <div className="pg-root min-h-[100dvh] dark:bg-black">
      <SiteHeader active="start" />
      <main>
        <section className="landing-container pb-16 pt-16 sm:pt-20">
          <h1 className="text-[36px] font-semibold leading-[1.08] tracking-[-0.02em] text-balance sm:text-[44px]">
            Add A2UI to your app
          </h1>
          <p className="mt-4 max-w-[64ch] text-[16px] leading-relaxed text-muted-foreground">
            One prompt for your coding agent. It installs CopilotKit, registers
            the design system you pick as an A2UI catalog and adds a Gemini
            runtime route, so your agent answers with UI your app draws.
          </p>
          <div className="mt-10 max-w-[920px]">
            <DesignSystemProvider draws={false}>
              <CopyPrompt />
            </DesignSystemProvider>
          </div>
        </section>

        <section className="border-t border-border">
          <div className="landing-container py-16 sm:py-20">
            <h2 className="text-[22px] font-semibold tracking-tight">
              Take it further
            </h2>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {NEXT.map((n) => {
                const className =
                  "group flex flex-col rounded-xl border border-border bg-card shadow-[0_1px_2px_oklch(var(--ink)/5%)] p-6 transition-colors hover:border-[oklch(var(--ink)/16%)] dark:bg-white/[0.02] dark:shadow-none dark:hover:bg-white/[0.035]";
                const Icon = n.download
                  ? Download
                  : n.external
                    ? ArrowUpRight
                    : ArrowRight;
                const body = (
                  <>
                    <span className="font-mono text-[13px] text-muted-foreground">
                      {n.label}
                    </span>
                    <span className="mt-3 flex items-center gap-1.5 text-[17px] font-semibold tracking-tight">
                      {n.title}
                      <Icon className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                    </span>
                    <span className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
                      {n.body}
                    </span>
                  </>
                );
                return n.external || n.download ? (
                  <a
                    key={n.title}
                    href={n.href}
                    {...(n.download
                      ? { download: true }
                      : { target: "_blank", rel: "noreferrer" })}
                    className={className}
                  >
                    {body}
                  </a>
                ) : (
                  <Link key={n.title} href={n.href} className={className}>
                    {body}
                  </Link>
                );
              })}
            </div>
          </div>
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
