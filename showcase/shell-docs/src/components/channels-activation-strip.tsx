"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { FrontendLogo } from "./frontend-logo";
import { FrameworkLogo } from "./icons/framework-icons";
import {
  CHANNELS_ACTIVATION_CHANNELS,
  CHANNELS_ACTIVATION_EVENTS,
  CHANNELS_OPENTAG_HREF,
  buildChannelsActivationPrompt,
  getChannelsActivationGuideHref,
} from "@/lib/channels-activation-contracts";
import type {
  ChannelsActivationBackendOption,
  ChannelsActivationChannelId,
} from "@/lib/channels-activation-contracts";

type CopyState = "idle" | "copied" | "error";

interface SelectOption {
  id: string;
  label: string;
  icon: React.ReactNode;
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function ActivationSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
}) {
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(selectedIndex);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = React.useId();
  const selected = options[selectedIndex];

  React.useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  React.useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  function openListbox(index = selectedIndex) {
    setActiveIndex(index);
    setOpen(true);
  }

  function closeAndRestoreFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function selectOption(option: SelectOption) {
    if (option.id !== value) onChange(option.id);
    closeAndRestoreFocus();
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openListbox(
        event.key === "ArrowDown"
          ? selectedIndex
          : Math.max(0, selectedIndex - 1),
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      openListbox(event.key === "Home" ? 0 : options.length - 1);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      closeAndRestoreFocus();
    }
  }

  function handleOptionKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }

    if (event.key === "Tab") {
      setOpen(false);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectOption(options[activeIndex]);
      return;
    }

    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") {
      nextIndex = (activeIndex + 1) % options.length;
    }
    if (event.key === "ArrowUp") {
      nextIndex = (activeIndex - 1 + options.length) % options.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;

    if (nextIndex !== undefined) {
      event.preventDefault();
      setActiveIndex(nextIndex);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        ref={triggerRef}
        type="button"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        onClick={() => (open ? closeAndRestoreFocus() : openListbox())}
        onKeyDown={handleTriggerKeyDown}
        className="shell-docs-radius-control flex min-h-12 w-full min-w-0 cursor-pointer items-center gap-2.5 border border-[var(--border)] bg-[var(--bg-surface)] px-3 text-left text-sm font-medium text-[var(--text)] shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center">
          {selected.icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{selected.label}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="shell-docs-radius-surface absolute left-0 top-[calc(100%+0.375rem)] z-[70] max-h-72 w-full min-w-[15rem] overflow-y-auto border border-[var(--border)] bg-[var(--bg-surface)] p-1.5 shadow-[var(--shadow-panel)]"
        >
          {options.map((option, index) => {
            const isSelected = option.id === value;
            const isActive = index === activeIndex;

            return (
              <button
                key={option.id}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectOption(option)}
                onFocus={() => setActiveIndex(index)}
                onKeyDown={handleOptionKeyDown}
                className={cn(
                  "shell-docs-radius-control flex min-h-11 w-full cursor-pointer items-center gap-2.5 px-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]",
                  isSelected
                    ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]",
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                  {option.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {isSelected ? (
                  <Check aria-hidden="true" className="h-4 w-4 shrink-0" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
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

  if (!backend) return null;

  const guideHref = getChannelsActivationGuideHref(channel, backend);
  const guideUrl = new URL(guideHref, docsBaseUrl).toString();
  // Rendered, not just copied. A copy button whose payload is invisible reads
  // as decoration — people missed it entirely. Now the prompt is short enough
  // to show, so the button becomes a shortcut for something already on screen.
  const prompt = buildChannelsActivationPrompt({
    channelLabel: selectedChannel.label,
    backendLabel: backend.label,
  });
  const channelOptions: SelectOption[] = CHANNELS_ACTIVATION_CHANNELS.map(
    (option) => ({
      id: option.id,
      label: option.label,
      icon: <FrontendLogo icon={option.icon} size={20} />,
    }),
  );
  const backendOptions: SelectOption[] = backends.map((option) => ({
    id: option.slug,
    label: option.label,
    icon: (
      <FrameworkLogo
        slug={option.slug}
        fallbackSrc={option.logo}
        size={20}
        className={cn(
          "shrink-0",
          option.slug === "built-in-agent"
            ? ""
            : "text-[var(--text-secondary)]",
        )}
      />
    ),
  }));

  function capture(event: string, properties: Record<string, unknown>) {
    try {
      posthog?.capture(event, properties);
    } catch {
      // Analytics must never interrupt docs navigation or clipboard actions.
    }
  }

  function selectChannel(value: string) {
    const nextChannel = value as ChannelsActivationChannelId;
    if (nextChannel === channel) return;

    const nextGuideHref = getChannelsActivationGuideHref(nextChannel, backend);
    capture(CHANNELS_ACTIVATION_EVENTS.channelSelected, {
      channel: nextChannel,
      previous_channel: channel,
      backend: backend.slug,
      from_path: pathname,
      destination_path: nextGuideHref,
    });
    setChannel(nextChannel);
    setCopyState("idle");
  }

  function selectBackend(value: string) {
    if (value === backend.slug) return;
    const nextBackend = backends.find((option) => option.slug === value);
    if (!nextBackend) return;

    const nextGuideHref = getChannelsActivationGuideHref(channel, nextBackend);
    capture(CHANNELS_ACTIVATION_EVENTS.backendSelected, {
      channel,
      backend: nextBackend.slug,
      previous_backend: backend.slug,
      from_path: pathname,
      destination_path: nextGuideHref,
    });
    setBackendSlug(nextBackend.slug);
    setCopyState("idle");
  }

  async function copyBuildPrompt() {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState("copied");
      capture(CHANNELS_ACTIVATION_EVENTS.promptCopied, {
        channel,
        backend: backend.slug,
        from_path: pathname,
        guide_url: guideUrl,
        // Every road into onboarding emits the same event with a distinct
        // surface, so the funnel can answer which one people actually take.
        surface: "docs_landing_strip",
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
        <p className="max-w-[68ch] text-sm leading-relaxed text-[var(--text-secondary)] sm:col-start-2 sm:text-[15px]">
          Bring your agent into Slack or Microsoft Teams, with more platforms on
          the way. Choose a channel and agent backend to open the matching setup
          guide, or copy a tailored prompt for your coding agent.
        </p>
      </div>

      <div className="mt-6 flex min-w-0 flex-col gap-3 border-t border-[var(--border)] pt-5 lg:flex-row lg:items-center">
        <ActivationSelect
          label="Choose a channel"
          value={channel}
          options={channelOptions}
          onChange={selectChannel}
        />
        <ActivationSelect
          label="Choose an agent backend"
          value={backend.slug}
          options={backendOptions}
          onChange={selectBackend}
        />

        <Link
          href={guideHref}
          onClick={() =>
            capture(CHANNELS_ACTIVATION_EVENTS.setupGuideOpened, {
              channel,
              backend: backend.slug,
              from_path: pathname,
              destination_path: guideHref,
            })
          }
          className="shell-docs-radius-control inline-flex min-h-12 shrink-0 items-center justify-center gap-1.5 border border-[var(--border)] bg-[var(--bg-elevated)] px-4 text-sm font-semibold text-[var(--text)] no-underline shadow-[var(--shadow-control)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Open setup guide
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>

        <span className="shrink-0 text-center text-xs text-[var(--text-muted)]">
          or
        </span>

        <button
          type="button"
          onClick={copyBuildPrompt}
          className="shell-docs-radius-control inline-flex min-h-12 min-w-[12.5rem] shrink-0 cursor-pointer items-center justify-center gap-2 border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)]"
        >
          <span>Build with your agent</span>
          <span
            aria-hidden="true"
            className="inline-flex w-[3.25rem] justify-end text-[11px] font-medium opacity-70"
          >
            {copyState === "copied"
              ? "Copied"
              : copyState === "error"
                ? "Error"
                : "Copy"}
          </span>
        </button>
        <span aria-live="polite" className="sr-only">
          {copyStatus}
        </span>
      </div>

      <p className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-[var(--radius-control)] border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 font-mono text-xs leading-relaxed text-[var(--text-secondary)]">
        {prompt}
      </p>

      <div className="mt-5 border-t border-[var(--border)] pt-4 text-sm text-[var(--text-secondary)]">
        Prefer a complete working example?{" "}
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
          Clone OpenTag on GitHub
        </a>
      </div>
    </section>
  );
}
