"use client";

import Link from "next/link";
import { SiDiscord, SiGithub, SiX } from "react-icons/si";
import { HomeDocsChat } from "@/components/ai/home-docs-chat";
import { CopilotKitLogo } from "@/components/copilotkit-logo";
import {
  AskAIGlyph,
  FrontendToolsGlyph,
  GenerativeUIGlyph,
  HumanInTheLoopGlyph,
  IntelligenceGlyph,
  LearningGlyph,
  SharedStateGlyph,
  ThreadsGlyph,
} from "@/components/icons/glyphs";
import { liveFramework } from "@/lib/live-scope";
import { getSetupLinks, getCapabilityLinks } from "@/lib/home-docs-links";
import { Button } from "@/components/ui/button";
import { useHomepageTelemetry } from "@/lib/telemetry/use-homepage-telemetry";
import { CopyPromptD } from "./copy-prompt-d";
import { useFrontend } from "./frontend";
import { useLastFramework } from "./last-framework";
import { LinkCard, Tray } from "./link-card";
import { FrontendChips } from "./pieces";
import { QuickstartMenu } from "./quickstart-menu";

const sectionTitle = "text-2xl leading-tight font-medium tracking-[-0.03em]";
const textLink = "underline underline-offset-4 hover:text-primary";

export function DHome() {
  const [rememberedFramework] = useLastFramework();
  const framework = liveFramework(rememberedFramework)
    ? rememberedFramework
    : "built-in-agent";
  const { frontend } = useFrontend();
  const scope = { framework, frontend };
  const track = useHomepageTelemetry();
  const setupLinks = getSetupLinks(scope);

  return (
    <div className="mx-auto flex w-full max-w-[72rem] flex-col gap-16 px-5 pt-10 pb-24 md:px-8 md:pt-14">
      <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:gap-12">
        <div className="flex flex-col items-start gap-6">
          <h1 className="text-[2.5rem] leading-[1.04] font-normal tracking-[-0.03em] text-balance md:text-[3.5rem]">
            Let agents and users{" "}
            <span className="-mb-[0.2em] inline-block bg-(image:--accent-gradient) bg-clip-text pb-[0.2em] font-medium text-transparent">
              work together
            </span>{" "}
            in your app
          </h1>
          <p className="max-w-[34rem] text-lg leading-[1.5] text-muted-foreground">
            Open-source APIs and components that connect app state, agent
            actions, and user input.
          </p>
          <a
            href="#start-building"
            className={`text-sm font-medium ${textLink}`}
          >
            Go to the quickstart ↓
          </a>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-sm leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">
              CopilotKit in action.
            </strong>{" "}
            Tell it what you’re building, and it will guide you through the
            docs.
          </p>
          <HomeDocsChat />
        </div>
      </section>

      <section id="start-building" className="flex scroll-mt-24 flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2 className={sectionTitle}>Start building</h2>
          <p className="text-muted-foreground">
            Choose your frontend and agent framework to open your quickstart.
          </p>
        </div>
        <FrontendChips />
        <div
          className="flex flex-wrap items-center gap-3"
          data-docs-copy-surface="docs_landing_hero"
        >
          <QuickstartMenu />
          {setupLinks.map((link) => (
            <Button
              key={link.url}
              nativeButton={false}
              render={<Link href={link.url} />}
              className="h-11 rounded-full px-5"
              onClick={() =>
                track("quickstart_selected", {
                  backend: framework,
                  destination: link.url,
                })
              }
            >
              {link.title}
            </Button>
          ))}
          <CopyPromptD />
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className={sectionTitle}>Explore capabilities</h2>
        <Tray matrix>
          {getCapabilityLinks(scope).map(({ id, title, description, url }) => (
            <LinkCard
              key={id}
              href={url}
              icon={CAPABILITY_ICONS[id]}
              title={title}
              description={description}
            />
          ))}
        </Tray>
      </section>

      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2 className={sectionTitle}>CopilotKit Intelligence</h2>
          <p className="text-muted-foreground">
            {frontend === "slack" || frontend === "teams"
              ? "CopilotKit Intelligence powers your channel integration, with event replay and Automatic Learning."
              : "Add event replay and Automatic Learning with an optional service."}
          </p>
        </div>
        <div className="grid gap-2 rounded-[20px] bg-frame p-2 sm:grid-cols-2">
          <LinkCard
            href="/AG-UI-Streams"
            icon={<IntelligenceGlyph />}
            title="AG-UI Streams"
            description="Restore interactive conversations and catch up after reconnecting."
          />
          <LinkCard
            href="/learning"
            icon={<LearningGlyph />}
            title="Automatic Learning"
            description="Turn patterns in real conversations into skills you review and publish."
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Free and paid options.{" "}
          <Link href="/intelligence/plans" className={textLink}>
            Compare plans
          </Link>
          {" · "}
          <Link href="/concepts/oss-vs-enterprise" className={textLink}>
            What’s included in open source?
          </Link>
        </p>
      </section>

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

const CAPABILITY_ICONS = {
  chat: <AskAIGlyph />,
  "generative-ui": <GenerativeUIGlyph />,
  "frontend-tools": <FrontendToolsGlyph />,
  "shared-state": <SharedStateGlyph />,
  "human-in-the-loop": <HumanInTheLoopGlyph />,
  threads: <ThreadsGlyph />,
};

const COMMUNITY = [
  { label: "Discord", url: "https://discord.gg/6dffbvGU3D", Icon: SiDiscord },
  { label: "X", url: "https://x.com/CopilotKit", Icon: SiX },
  {
    label: "GitHub",
    url: "https://github.com/CopilotKit/CopilotKit",
    Icon: SiGithub,
  },
];
