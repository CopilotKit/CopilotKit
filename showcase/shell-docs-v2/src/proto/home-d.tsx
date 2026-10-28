"use client";

import Link from "next/link";
import { HomeDocsChat } from "@/components/ai/home-docs-chat";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { liveFramework } from "@/lib/live-scope";
import { getSetupLinks } from "@/lib/home-docs-links";
import { useHomepageTelemetry } from "@/lib/telemetry/use-homepage-telemetry";
import { CopyPromptD } from "./copy-prompt-d";
import { useFrontend } from "./frontend";
import { useLastFramework } from "./last-framework";
import { FrontendChips } from "./pieces";
import { QuickstartMenu } from "./quickstart-menu";

export function DHome() {
  return (
    <div className="mx-auto w-full max-w-[80rem] px-5 pt-10 pb-16 md:px-8 md:pt-12">
      <section className="flex flex-col gap-8 md:gap-10">
        <div className="flex flex-col items-center gap-5 text-center">
          <h1 className="text-[2.5rem] leading-[1.04] font-normal tracking-[-0.03em] text-balance md:text-[3.5rem]">
            Let agents <span aria-hidden="true">🤝</span>
            <span className="sr-only">and</span> users
            <br />
            <span className="-mb-[0.2em] inline-block bg-(image:--accent-gradient) bg-clip-text pb-[0.2em] font-medium text-transparent">
              work together
            </span>{" "}
            in your app
          </h1>
          <p className="text-lg leading-[1.5] text-muted-foreground">
            An open-source platform connecting agents, app state, and user
            input.
          </p>
          <div
            className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3"
            data-docs-copy-surface="docs_landing_hero"
          >
            <CopyPromptD />
            <QuickstartPicker />
          </div>
        </div>
        <div className="mx-auto flex w-full min-w-0 max-w-[52rem] flex-col gap-3 xl:max-w-[68rem]">
          <p className="text-center text-sm leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">
              CopilotKit in action.
            </strong>{" "}
            Tell it what you’re building, and it will guide you through the
            docs.
          </p>
          <HomeDocsChat />
        </div>
      </section>
    </div>
  );
}

/** Direct setup stays available without opening the full guide directory. */
function QuickstartPicker() {
  const [rememberedFramework] = useLastFramework();
  const framework = liveFramework(rememberedFramework)
    ? rememberedFramework
    : "built-in-agent";
  const { frontend } = useFrontend();
  const track = useHomepageTelemetry();
  const setupLinks = getSetupLinks({ framework, frontend });

  return (
    <Popover>
      <PopoverTrigger className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
        Go to the quickstart ↓
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={12}
        className="max-h-(--available-height) w-[min(32rem,calc(100vw-2rem))] gap-6 overflow-y-auto rounded-2xl p-5"
      >
        <PopoverHeader>
          <PopoverTitle>Start building</PopoverTitle>
          <PopoverDescription>
            Choose your frontend and agent framework.
          </PopoverDescription>
        </PopoverHeader>
        <FrontendChips />
        <div className="flex flex-wrap items-center gap-3">
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
        </div>
      </PopoverContent>
    </Popover>
  );
}
