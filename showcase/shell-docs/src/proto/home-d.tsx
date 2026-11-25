"use client";

import { SiDiscord, SiGithub, SiX } from "react-icons/si";
import { PixelMatrix } from "@/components/brand/pixel-matrix";
import { CopilotKitLogo } from "@/components/copilotkit-logo";
import {
  BusinessGlyph,
  IntelligenceGlyph,
  OpenBotGlyph,
  OtherGlyph,
} from "@/components/icons/glyphs";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import {
  EARLY_ACCESS_CHANNELS,
  earlyAccessHref,
} from "@/lib/early-access/channels";
import { EarlyAccessBadge } from "@/components/early-access/badge";
import { useIntegrationClickTracking } from "@/components/telemetry/homepage";
import {
  FRAMEWORKS,
  FRAMEWORK_FAMILIES,
  FRONTENDS,
  TOPICS,
  TOPIC_SUMMARY,
} from "./data";
import { CopyPromptD } from "./copy-prompt-d";
import { FamilyCard, LinkCard, Tray } from "./link-card";
import { QuickstartMenu } from "./quickstart-menu";
import { useStackHref } from "./stack-href";
import { StackDiagram } from "./stack-diagram";
import { TopicGlyph } from "./topic-glyph";

/** Topics whose card opens a page other than their slug. */
const TOPIC_PATH: Partial<Record<string, string>> = {
  // The Generative UI overview is retired; its first Controlled page leads.
  "generative-ui": "generative-ui/tool-based",
  // `/threads` only redirects here, and the card checks the page exists.
  threads: "AG-UI-Streams",
};

const sectionTitle = "text-2xl leading-tight font-medium tracking-[-0.03em]";

/**
 * The home. Every card opens on the reader's stack, the frontend and
 * framework they last read docs for: a topic on both, a frontend with their
 * framework, a framework on their frontend.
 */
export function DHome() {
  const stackHref = useStackHref();
  const trackIntegrationClick = useIntegrationClickTracking();

  return (
    <div className="mx-auto flex w-full max-w-[72rem] flex-col gap-16 px-5 pt-12 pb-24 md:px-8 md:pt-16">
      <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-14">
        <div className="flex flex-col items-start gap-8">
          {/* The website's display voice: regular weight and tight, with its
              lilac-to-mint accent on the words that matter. */}
          <div className="flex flex-col gap-5">
            <h1 className="text-[2.5rem] leading-[1.04] font-normal tracking-[-0.03em] text-balance md:text-[3.5rem]">
              Connect your app to{" "}
              <span className="-mb-[0.2em] inline-block bg-(image:--accent-gradient) bg-clip-text pb-[0.2em] font-medium text-transparent">
                any agent
              </span>
            </h1>
            <p className="max-w-[34rem] text-lg leading-[1.5] text-muted-foreground">
              CopilotKit adds chat, generative UI, and human approvals to your
              frontend, with the agent framework you already use.
            </p>
          </div>
          {/* Telemetry: copies in here report docs_conversion_copied. */}
          <div
            className="flex flex-wrap items-center gap-3"
            data-docs-copy-surface="docs_landing_hero"
          >
            <QuickstartMenu />
            <CopyPromptD />
          </div>
        </div>
        {/* The pixel matrix on the website's framed protocol-map stage, lit
            under the pointer. */}
        <div className="relative isolate overflow-hidden rounded-[20px] border-[1.5px] border-stage-rim bg-(image:--stage) px-5 py-7 shadow-lift-stage sm:px-8 sm:py-9">
          <PixelMatrix interactive glisten />
          <StackDiagram />
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className={sectionTitle}>Guides</h2>
        <Tray variant="bare">
          {TOPICS.map((t) => (
            <LinkCard
              key={t.slug}
              href={stackHref(TOPIC_PATH[t.slug] ?? t.slug)}
              icon={<TopicGlyph slug={t.slug} />}
              title={t.title}
              description={TOPIC_SUMMARY[t.slug]}
            />
          ))}
          <LinkCard
            href={stackHref("intelligence/overview")}
            icon={<IntelligenceGlyph />}
            title="Intelligence"
            description="Threads that persist, user memories, and agents that learn from real use."
          />
        </Tray>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className={sectionTitle}>Frontends</h2>
        <Tray variant="bare">
          {FRONTENDS.map((f) => (
            <LinkCard
              key={f.id}
              href={stackHref("", { frontend: f.id })}
              glyph="logo"
              icon={<FrontendLogo icon={f.id} size={22} />}
              title={f.name}
              description={f.summary}
            />
          ))}
          {/* The early-access channels, after Teams: each opens its landing
              page. SMS has no brand mark, so its glyph takes the accent. */}
          {EARLY_ACCESS_CHANNELS.map((c) => (
            <LinkCard
              key={c.id}
              href={earlyAccessHref(c.id)}
              glyph={c.id === "sms" ? "ink" : "logo"}
              icon={<FrontendLogo icon={c.id} size={22} />}
              title={c.name}
              description={c.summary}
              badge={<EarlyAccessBadge />}
            />
          ))}
        </Tray>
      </section>

      <section className="flex flex-col gap-5" onClick={trackIntegrationClick}>
        <h2 className={sectionTitle}>Integrations</h2>
        <Tray variant="bare">
          {FRAMEWORKS.map((f) => {
            // A framework in several languages is one card, where its first
            // variant would be; the other variants fold into it.
            const family = FRAMEWORK_FAMILIES.find((fam) =>
              fam.variants.some((v) => v.id === f.id),
            );
            if (!family) {
              return (
                <LinkCard
                  key={f.id}
                  href={stackHref("quickstart", { framework: f.id })}
                  glyph="logo"
                  icon={<FrameworkLogo slug={f.id} size={22} />}
                  title={f.name}
                  description={f.summary}
                />
              );
            }
            if (family.variants[0].id !== f.id) return null;
            return (
              <FamilyCard
                key={family.name}
                name={family.name}
                summary={family.summary}
                variants={family.variants.map((v) => ({
                  ...v,
                  href: stackHref("quickstart", { framework: v.id }),
                }))}
              />
            );
          })}
        </Tray>
      </section>

      {/* OpenBot, as on docs.copilotkit.ai's home. */}
      <section className="flex flex-col gap-5">
        <h2 className={sectionTitle}>Built with CopilotKit</h2>
        <Tray variant="bare">
          <LinkCard
            href="https://open.bot"
            icon={<OpenBotGlyph />}
            title="OpenBot"
            description="The self-hostable workspace for AI coworkers, built on CopilotKit and AG-UI."
          />
          <LinkCard
            href="https://open.bot/business"
            icon={<BusinessGlyph />}
            title="OpenBot for Business"
            description="Enterprise governance for AI coworkers: boundaries, SSO, and audit."
          />
          <LinkCard
            href="https://open.bot/builders#start"
            icon={<OtherGlyph />}
            title="Setup guide for builders"
            description="Choose the models, tools, and infrastructure your coworkers run on."
          />
        </Tray>
      </section>

      {/* The community links live here, so the navbar keeps to search,
          theme, GitHub, and the one call to action. */}
      <footer className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t pt-8 text-sm text-muted-foreground">
        <CopilotKitLogo className="me-auto h-5 w-auto text-foreground" />
        {COMMUNITY.map((c) => (
          <a
            key={c.label}
            href={c.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center gap-2 transition-colors hover:text-foreground"
          >
            <c.Icon className="size-4" aria-hidden="true" />
            {c.label}
          </a>
        ))}
      </footer>
    </div>
  );
}

const COMMUNITY = [
  { label: "Discord", url: "https://discord.gg/6dffbvGU3D", Icon: SiDiscord },
  { label: "X", url: "https://x.com/CopilotKit", Icon: SiX },
  {
    label: "GitHub",
    url: "https://github.com/CopilotKit/CopilotKit",
    Icon: SiGithub,
  },
];
