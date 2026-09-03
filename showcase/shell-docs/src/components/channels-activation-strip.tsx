"use client";

import React from "react";
import Link from "next/link";
import { Copy } from "lucide-react";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { FrontendLogo } from "./frontend-logo";
import { FrameworkLogo } from "./icons/framework-icons";
import {
  CHANNELS_ACTIVATION_CHANNELS,
  CHANNELS_ACTIVATION_EVENTS,
  CHANNELS_ACTIVATION_SURFACES,
  CHANNELS_OPENTAG_HREF,
  CHANNELS_BUILD_PROMPT,
  getChannelsActivationGuideHref,
} from "@/lib/channels-activation-contracts";
import type {
  ChannelsActivationBackendOption,
  ChannelsActivationChannelId,
} from "@/lib/channels-activation-contracts";

type CopyState = "idle" | "copied" | "error";

/** In-docs path for the Channels overview. */
const CHANNELS_SDK_DOCS_PATH = "/channels";

interface SelectOption {
  id: string;
  label: string;
  icon: React.ReactNode;
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export interface ChannelsActivationStripProps {
  backends: ChannelsActivationBackendOption[];
  docsBaseUrl: string;
}

export function ChannelsActivationStrip({
  backends,
  docsBaseUrl,
}: ChannelsActivationStripProps) {
  const pathname = usePathname() ?? "/";
  const posthog = usePostHog();
  const [channel, setChannel] =
    React.useState<ChannelsActivationChannelId>("slack");
  const [backendSlug, setBackendSlug] = React.useState(backends[0]?.slug ?? "");
  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const resetTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const stripRef = React.useRef<HTMLElement | null>(null);
  const viewedRef = React.useRef(false);

  const backend =
    backends.find((option) => option.slug === backendSlug) ?? backends[0];
  const selectedChannel =
    CHANNELS_ACTIVATION_CHANNELS.find((option) => option.id === channel) ??
    CHANNELS_ACTIVATION_CHANNELS[0];

  React.useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  // Impression, so the copy count has a denominator. The strip sits below the
  // fold on the landing page, so mount is not the same as seen.
  React.useEffect(() => {
    const node = stripRef.current;
    if (!node || viewedRef.current) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || viewedRef.current) continue;
          viewedRef.current = true;
          observer.disconnect();
          capture(CHANNELS_ACTIVATION_EVENTS.viewed, {
            channel,
            backend: backendSlug,
            from_path: pathname,
            surface: CHANNELS_ACTIVATION_SURFACES.docsLandingStrip,
          });
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(node);
    return () => observer.disconnect();
    // Fires once for the first selection the reader is shown; later channel and
    // backend switches already emit their own selection events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!backend) return null;

  const guideHref = getChannelsActivationGuideHref(channel, backend);
  const guideUrl = new URL(guideHref, docsBaseUrl).toString();

  function capture(event: string, properties: Record<string, unknown>) {
    try {
      posthog?.capture(event, properties);
    } catch {
      // Analytics must never interrupt docs navigation or clipboard actions.
    }
  }

  async function copyBuildPrompt() {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    try {
      await navigator.clipboard.writeText(CHANNELS_BUILD_PROMPT);
      setCopyState("copied");
      capture(CHANNELS_ACTIVATION_EVENTS.promptCopied, {
        channel,
        backend: backend.slug,
        from_path: pathname,
        guide_url: guideUrl,
        // Every road into onboarding emits the same event with a distinct
        // surface, so the funnel can answer which one people actually take.
        surface: CHANNELS_ACTIVATION_SURFACES.docsLandingStrip,
      });
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
      resetTimerRef.current = setTimeout(() => setCopyState("idle"), 2600);
    }
  }

  const copyStatus =
    copyState === "copied"
      ? "Prompt copied"
      : copyState === "error"
        ? "Copy failed"
        : "";

  return (
    <section
      ref={stripRef}
      aria-labelledby="channels-activation-heading"
      className="shell-docs-radius-surface not-prose relative overflow-visible border p-5 sm:p-6"
      style={{
        borderColor: "color-mix(in oklch, var(--accent) 28%, var(--border))",
        background:
          "linear-gradient(145deg, color-mix(in oklch, var(--accent) 9%, var(--bg-surface)) 0%, var(--bg-surface) 58%)",
        boxShadow:
          "0 18px 42px color-mix(in oklch, var(--accent) 8%, transparent)",
      }}
    >
      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div
          aria-hidden="true"
          className="shell-docs-radius-control flex h-12 shrink-0 items-center -space-x-2 border border-[var(--border)] bg-[var(--bg-surface)] px-2 shadow-[var(--shadow-control)]"
        >
          <span className="shell-docs-radius-icon relative z-[1] flex h-8 w-8 items-center justify-center border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-control)]">
            <FrontendLogo icon="slack" size={18} />
          </span>
          <span className="shell-docs-radius-icon relative flex h-8 w-8 items-center justify-center border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-control)]">
            <FrontendLogo icon="teams" size={18} />
          </span>
        </div>

        <h2
          id="channels-activation-heading"
          className="self-center text-2xl font-semibold tracking-[-0.02em] text-[var(--text)] sm:text-[1.75rem]"
        >
          The Channels SDK brings your agents where work happens.
        </h2>
        {/* Action to the right of the copy, both under the heading. The channel
            and backend pickers are gone: the guide asks which platform and
            framework the developer wants, so choosing here asked the same
            question twice and changed nothing about what got copied. */}
        <div className="flex flex-col gap-4 sm:col-start-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p className="m-0 max-w-[68ch] text-sm leading-relaxed text-[var(--text-secondary)] sm:text-[15px]">
            Bring your agent into Slack or Microsoft Teams, with more platforms
            on the way. Copy this prompt and your coding agent builds your first
            channel with you, on any supported agent framework.
          </p>

          <button
            type="button"
            onClick={copyBuildPrompt}
            className="shell-docs-radius-control inline-flex min-h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-[var(--accent-fill)] bg-[var(--accent-fill)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none sm:w-auto"
          >
            <Copy aria-hidden="true" className="h-4 w-4" />
            {copyState === "copied"
              ? "Copied"
              : copyState === "error"
                ? "Copy blocked"
                : "Copy prompt"}
          </button>
          <span aria-live="polite" className="sr-only">
            {copyStatus}
          </span>
        </div>
      </div>

      <div className="mt-5 border-t border-[var(--border)] pt-4 text-sm text-[var(--text-secondary)]">
        Prefer to do it yourself?{" "}
        <Link
          href={CHANNELS_SDK_DOCS_PATH}
          onClick={() =>
            capture(CHANNELS_ACTIVATION_EVENTS.setupGuideOpened, {
              channel,
              backend: backend.slug,
              from_path: pathname,
              destination_path: CHANNELS_SDK_DOCS_PATH,
            })
          }
          className="font-semibold text-[var(--accent)] underline decoration-[var(--accent)]/30 underline-offset-4 hover:decoration-[var(--accent)]"
        >
          Read the Channels docs
        </Link>{" "}
        or{" "}
        <a
          href={CHANNELS_OPENTAG_HREF}
          target="_blank"
          rel="noreferrer"
          onClick={() =>
            capture(CHANNELS_ACTIVATION_EVENTS.openTagClicked, {
              channel,
              backend: backend.slug,
              from_path: pathname,
              destination_url: CHANNELS_OPENTAG_HREF,
            })
          }
          className="font-semibold text-[var(--accent)] underline decoration-[var(--accent)]/30 underline-offset-4 hover:decoration-[var(--accent)]"
        >
          clone OpenTag on GitHub
        </a>{" "}
        for a complete working example.
      </div>
    </section>
  );
}
