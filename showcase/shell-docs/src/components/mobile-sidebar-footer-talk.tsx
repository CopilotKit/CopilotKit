"use client";

import { Calendar } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { TALK_TO_ENGINEER_HREF } from "./brand-nav";

export function MobileSidebarFooterTalk() {
  const posthog = usePostHog();

  const handleTalkToEngineersClick = () => {
    posthog?.capture("talk_to_us_clicked", {
      location: "docs_sidebar_mobile_footer",
    });
    window.location.href = TALK_TO_ENGINEER_HREF;
  };

  return (
    <button
      type="button"
      onClick={handleTalkToEngineersClick}
      className="shell-docs-radius-control flex h-10 w-full items-center justify-center gap-2 border border-transparent bg-[var(--accent)] px-3 text-sm font-medium text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] active:translate-y-px xl:hidden"
    >
      <Calendar className="h-4 w-4" aria-hidden="true" />
      Talk to an engineer
    </button>
  );
}
