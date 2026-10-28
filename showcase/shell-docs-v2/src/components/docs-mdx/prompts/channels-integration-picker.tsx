"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useHomepageTelemetry } from "@/lib/telemetry/use-homepage-telemetry";
import type { LandingIntegration } from "./landing-integrations";

const CHANNELS = [
  { id: "slack", name: "Slack" },
  { id: "teams", name: "Teams" },
] as const;

type Channel = (typeof CHANNELS)[number]["id"];

/** A channel's guide for a framework; the Built-in Agent's is the channel root. */
function channelHref(slug: string, channel: Channel): string {
  return slug === "built-in-agent" ? `/${channel}` : `/${channel}/${slug}`;
}

const ROW =
  "group flex min-h-14 w-full cursor-pointer items-center gap-3 border-b py-3 text-start text-sm font-medium text-foreground no-underline transition-colors hover:text-primary focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-popup-open:text-primary";

/**
 * Pick Slack or Teams, then the agent framework you already run, and land on
 * that framework's channel guide (shell-docs' `ChannelsIntegrationPicker`,
 * with its `docs.homepage_*` events).
 */
export function ChannelsIntegrationPicker({
  integrations,
}: {
  integrations: readonly LandingIntegration[];
}) {
  const [channel, setChannel] = useState<Channel>("slack");
  const labelId = useId();
  const track = useHomepageTelemetry();

  return (
    <div className="not-prose my-6">
      <p id={labelId} className="mb-3 text-sm text-muted-foreground">
        Your channel
      </p>
      <ToggleGroup
        aria-labelledby={labelId}
        value={[channel]}
        onValueChange={(value) => {
          const next = value[0] as Channel | undefined;
          if (!next) return;
          setChannel(next);
          track("frontend_selected", {
            frontend: next,
            surface: "integration_directory",
          });
        }}
        variant="outline"
        spacing={1.5}
        className="relative z-10 flex-wrap"
      >
        {CHANNELS.map((option) => (
          <ToggleGroupItem
            key={option.id}
            value={option.id}
            // The ::after strip grows the touch target to 44px tall.
            className="relative h-8 gap-1.5 rounded-full bg-card px-3 text-sm font-medium text-muted-foreground after:absolute after:inset-x-0 after:-inset-y-2 hover:bg-accent hover:text-foreground aria-pressed:border-brand-lilac-mid aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-brand-lilac-mid dark:aria-pressed:border-brand-lilac dark:aria-pressed:ring-brand-lilac"
          >
            <FrontendLogo icon={option.id} size={14} />
            {option.name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <p className="mt-7 text-sm text-muted-foreground">Your agent backend</p>
      <div className="mt-1 grid grid-cols-1 gap-x-7 sm:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => {
          const row = (
            <>
              <span aria-hidden className="flex size-6 shrink-0 items-center justify-center">
                <FrameworkLogo
                  slug={integration.logoSlug}
                  fallbackSrc={integration.logo}
                  size={20}
                />
              </span>
              <span className="flex-1 leading-snug">{integration.name}</span>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
              />
            </>
          );
          const select = (slug: string) =>
            track("integration_selected", {
              frontend: channel,
              backend: slug,
              destination: channelHref(slug, channel),
            });

          if (integration.choices.length === 1) {
            const slug = integration.choices[0].slug;
            return (
              <Link
                key={integration.id}
                href={channelHref(slug, channel)}
                onClick={() => select(slug)}
                className={ROW}
              >
                {row}
              </Link>
            );
          }
          return (
            <Popover key={integration.id}>
              <PopoverTrigger className={ROW}>{row}</PopoverTrigger>
              <PopoverContent
                align="start"
                aria-label={`${integration.name} language`}
                className="w-56 gap-0 p-1.5"
              >
                <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
                  Choose your language
                </p>
                {integration.choices.map((choice) => (
                  <Link
                    key={choice.slug}
                    href={channelHref(choice.slug, channel)}
                    onClick={() => select(choice.slug)}
                    className="block rounded-md px-2.5 py-2.5 text-sm hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    {choice.name}
                  </Link>
                ))}
              </PopoverContent>
            </Popover>
          );
        })}
      </div>
    </div>
  );
}
