"use client";

import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ROOT_FRAMEWORK, frontendHref } from "@/lib/live-scope";
import { frontendById } from "@/lib/frontends";
import type { FrontendId } from "@/lib/frontends";
import { useLastFramework } from "./last-framework";
import { FrontendOptions, usePickFrontend } from "./pieces";

/**
 * The frontend picker on an early-access frontend's landing page, which has
 * no docs sidebar: the sidebar's list, with this frontend checked. A pick
 * does what it does in the sidebar: the frontend is remembered and its home
 * opens on the reader's remembered framework (`/vue/mastra`, React's
 * `/mastra/quickstart`, another early-access frontend's landing page).
 */
export function ChannelSwitcher({ channel }: { channel: FrontendId }) {
  const pickFrontend = usePickFrontend();
  const [framework] = useLastFramework();
  const [open, setOpen] = useState(false);
  const name = frontendById(channel)?.name ?? channel;
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
            onPick={(id) => {
              setOpen(false);
              if (id === channel) return;
              pickFrontend({
                frontend: id,
                from: channel,
                framework,
                destination: frontendHref(
                  framework === ROOT_FRAMEWORK ? [] : [framework],
                  id,
                  "",
                ),
              });
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
