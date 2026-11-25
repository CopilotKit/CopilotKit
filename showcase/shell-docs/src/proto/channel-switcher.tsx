"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ROOT_FRAMEWORK, frontendHref } from "@/lib/live-scope";
import {
  earlyAccessChannel,
  earlyAccessHref,
} from "@/lib/early-access/channels";
import type { EarlyAccessChannelId } from "@/lib/early-access/channels";
import { trackEvent } from "@/lib/telemetry/analytics";
import { useFrontend } from "./frontend";
import { useLastFramework } from "./last-framework";
import { FrontendOptions } from "./pieces";

/**
 * The frontend picker on an early-access channel's page, which has no docs
 * sidebar: the same list as the sidebar's, with this channel checked. A docs
 * frontend opens its home on the reader's remembered framework (`/vue/mastra`,
 * React's `/mastra/quickstart`) and is remembered; another early-access
 * channel opens its page and leaves the remembered frontend alone.
 */
export function ChannelSwitcher({
  channel,
}: {
  channel: EarlyAccessChannelId;
}) {
  const { setFrontend } = useFrontend();
  const [framework] = useLastFramework();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const name = earlyAccessChannel(channel)?.name ?? channel;
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <span aria-hidden="true" className="text-muted-foreground">
        Frontend
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={`Frontend: ${name}`}
          // 40px tall; an invisible ::after makes the hit area 44px.
          className="relative flex h-10 items-center gap-2 rounded-full border bg-card ps-3 pe-2.5 font-medium shadow-lift outline-none transition-colors after:absolute after:-inset-y-0.5 after:inset-x-0 after:content-[''] hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:bg-accent motion-reduce:transition-none dark:bg-[#1e1e2a]"
        >
          <FrontendLogo icon={channel} size={16} className="shrink-0" />
          {name}
          <ChevronsUpDown
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="flex max-h-[min(30rem,var(--available-height))] w-[min(20rem,calc(100vw-2rem))] flex-col gap-0 overflow-y-auto rounded-xl p-0 ring-frame-rim"
        >
          <FrontendOptions
            current={channel}
            onPick={(pick) => {
              setOpen(false);
              if (pick.id === channel) return;
              if (pick.earlyAccess) {
                const destination = earlyAccessHref(pick.id);
                trackEvent("docs.frontend_selected", {
                  frontend: pick.id,
                  from_frontend: channel,
                  backend: framework,
                  from_path: pathname,
                  destination_path: destination,
                  early_access: true,
                });
                router.push(destination);
                return;
              }
              // A docs frontend: remembered, and opened at its home on the
              // framework the reader was reading before this page.
              setFrontend(pick.id);
              const destination = frontendHref(
                framework === ROOT_FRAMEWORK ? [] : [framework],
                pick.id,
                "",
              );
              trackEvent("docs.frontend_selected", {
                frontend: pick.id,
                from_frontend: channel,
                backend: framework,
                from_path: pathname,
                destination_path: destination,
              });
              router.push(destination);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
