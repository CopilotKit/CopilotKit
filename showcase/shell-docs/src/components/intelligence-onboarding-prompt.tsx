"use client";

import React from "react";
import { Copy, Lightbulb, MessagesSquare } from "lucide-react";
import { usePathname } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { onboardingFrameworkSlug } from "@/lib/intelligence-onboarding-framework";
import {
  createIntelligenceOnboardingPrompt,
  INTELLIGENCE_ONBOARDING_EVENTS,
} from "@/lib/intelligence-onboarding-prompt";
import { useOnboardingRunId } from "@/lib/hooks/use-onboarding-run-id";

export type IntelligenceOnboardingFeature = "learning" | "threads";

export interface IntelligenceOnboardingPromptProps {
  feature: IntelligenceOnboardingFeature;
  surface: string;
  /**
   * The agent framework the surrounding docs page is about: `slug` is the
   * docs registry slug, `name` the display name. Supplied by `DocsPageView`
   * through the MDX component map, because this banner is hand-placed in MDX
   * and cannot know which framework's page it landed on.
   *
   * Analytics only — the copied text does not change. Optional, because a
   * page can exist without a registry record to name.
   */
  framework?: { slug: string; name: string };
}

const FEATURE_COPY = {
  learning: {
    title: "Build agents that get smarter with every use.",
    points: [
      {
        label: "Rich Threads",
        body: "keep messages, generative UI, and tool activity available across sessions and devices.",
      },
      {
        label: "Learning",
        body: "turns real usage into skills that improve your agent.",
      },
      {
        body: "Build a new agent or bring one you already have. Any frontend, any backend.",
      },
    ],
  },
  threads: {
    title: "Conversations that never lose context.",
    points: [
      {
        label: "CopilotKit Intelligence Rich Threads",
        body: "keep messages, generative UI, and tool activity available across sessions and devices. Build a new agent or bring one you already have. Any frontend, any backend.",
      },
    ],
  },
} as const;

type CopyState = "idle" | "copied" | "error";

/** One onboarding action with feature-specific value copy. */
export function IntelligenceOnboardingPrompt({
  feature,
  surface,
  framework,
}: IntelligenceOnboardingPromptProps): React.JSX.Element {
  const content = FEATURE_COPY[feature];
  const pathname = usePathname();
  const posthog = usePostHog();
  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const getRunId = useOnboardingRunId();
  const headingId = React.useId();

  function capture(event: string, properties: Record<string, unknown>) {
    try {
      posthog?.capture(event, properties);
    } catch {
      // Analytics must never interrupt docs rendering or clipboard actions.
    }
  }

  async function copyPrompt() {
    const effectiveRunId = getRunId();

    try {
      await navigator.clipboard.writeText(
        createIntelligenceOnboardingPrompt(effectiveRunId),
      );
    } catch {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 2600);
      return;
    }

    setCopyState("copied");
    capture(INTELLIGENCE_ONBOARDING_EVENTS.promptCopied, {
      feature,
      from_path: pathname,
      onboarding_run_id: effectiveRunId,
      surface,
      // The graph slug, not the docs slug, so this property joins the value
      // the CLI records for the same run. Left off the payload entirely when
      // the graph has no equivalent, rather than sent as a placeholder that
      // would pollute breakdowns.
      ...(framework && onboardingFrameworkSlug(framework.slug)
        ? { agent_framework: onboardingFrameworkSlug(framework.slug) }
        : {}),
    });
    setTimeout(() => setCopyState("idle"), 1800);
  }

  return (
    <section
      aria-labelledby={headingId}
      data-feature={feature}
      data-surface={surface}
      className="shell-docs-radius-surface not-prose relative border border-[#DBDBE5] bg-[linear-gradient(135deg,#FFFFFF_0%,#F7F7F9_46%,#EDEDF5_100%)] p-5 shadow-[0_1px_3px_rgba(1,5,7,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] dark:border-[#57575B] dark:bg-[linear-gradient(135deg,#2B2B2B_0%,color-mix(in_oklch,#EDEDF5_8%,var(--bg-surface))_100%)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.32)]"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="shell-docs-radius-control flex h-10 w-10 shrink-0 items-center justify-center border border-[#DBDBE5] bg-white text-[var(--accent)] shadow-[0_1px_3px_rgba(1,5,7,0.08)] dark:border-[#57575B] dark:bg-[#2B2B2B]"
          >
            {feature === "learning" ? (
              <Lightbulb className="h-[22px] w-[22px]" strokeWidth={2} />
            ) : (
              <MessagesSquare className="h-[22px] w-[22px]" strokeWidth={2} />
            )}
          </span>

          <h2
            id={headingId}
            className="!m-0 text-xl font-semibold tracking-[-0.02em] text-[var(--text)] sm:text-2xl"
          >
            {content.title}
          </h2>
        </div>

        <button
          type="button"
          // The global copy tracker resolves the surface with
          // `document.activeElement.closest(...)`, so an ancestor would work
          // too. It sits on the button because that is the only element of
          // this banner that should count as this surface.
          data-docs-copy-surface={surface}
          onClick={copyPrompt}
          className="shell-docs-radius-control inline-flex min-h-10 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-[#010507] bg-[#010507] px-4 text-sm font-semibold text-white shadow-[0_1px_3px_rgba(1,5,7,0.12)] transition-[background-color,transform] hover:bg-[#2B2B2B] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#BEC2FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#EDEDF5] sm:w-auto"
        >
          <Copy aria-hidden="true" className="h-4 w-4" />
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Copy blocked"
              : "Copy prompt"}
        </button>
      </div>

      {feature === "learning" ? (
        <div className="mt-4 border-t border-[#DBDBE5] pt-3 text-sm leading-[1.55] text-[var(--text-secondary)] dark:border-[#57575B]">
          <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1.25fr] md:gap-0">
            {content.points.map((point, index) => (
              <p
                key={point.body}
                className={`!m-0 ${index > 0 ? "md:border-l md:border-[#DBDBE5] md:pl-5 dark:md:border-[#57575B]" : ""} ${index < content.points.length - 1 ? "md:pr-5" : ""}`}
              >
                {"label" in point ? (
                  <span className="font-semibold text-[var(--text)]">
                    {point.label}{" "}
                  </span>
                ) : null}
                {index === 2 ? (
                  <>
                    <span className="font-semibold text-[var(--text)]">
                      Build
                    </span>{" "}
                    a new agent or{" "}
                    <span className="font-semibold text-[var(--text)]">
                      bring
                    </span>{" "}
                    one you already have. Any frontend, any backend.
                  </>
                ) : (
                  point.body
                )}
              </p>
            ))}
          </div>
        </div>
      ) : (
        <p className="!mb-0 !mt-4 border-t border-[#DBDBE5] pt-3 text-sm leading-[1.55] text-[var(--text-secondary)] dark:border-[#57575B]">
          {content.points.map((point) => (
            <React.Fragment key={point.body}>
              {"label" in point ? (
                <span className="font-semibold text-[var(--text)]">
                  {point.label}{" "}
                </span>
              ) : null}
              <span>{point.body} </span>
            </React.Fragment>
          ))}
        </p>
      )}

      <span aria-live="polite" className="sr-only">
        {copyState === "copied"
          ? "Prompt copied"
          : copyState === "error"
            ? "Prompt copy failed. Try again."
            : ""}
      </span>
    </section>
  );
}
