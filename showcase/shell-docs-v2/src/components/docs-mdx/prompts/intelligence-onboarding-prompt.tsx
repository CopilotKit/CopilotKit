"use client";

import { Fragment, useId } from "react";
import { usePathname } from "next/navigation";
import { LearningGlyph, ThreadsGlyph } from "@/components/icons/glyphs";
import type { DocsScope } from "../scope";
import {
  INTELLIGENCE_ONBOARDING_EVENTS,
  createIntelligenceOnboardingPrompt,
  createOnboardingRunId,
} from "./onboarding";
import { DocsPromptActions } from "./prompt-actions";

export type IntelligenceOnboardingFeature = "learning" | "threads";

const FEATURE_COPY = {
  learning: {
    title: "Build agents that get smarter with every use.",
    points: [
      {
        label: "AG-UI Streams",
        body: "keep messages, generative UI, and tool activity available across sessions and devices.",
      },
      {
        label: "Automatic Learning",
        body: "turns real usage into skills that improve your agent.",
      },
    ],
  },
  threads: {
    title: "Conversations that never lose context.",
    points: [
      {
        label: "CopilotKit Intelligence AG-UI Streams",
        body: "keep messages, generative UI, and tool activity available across sessions and devices. Build a new agent or bring one you already have. Any frontend, any backend.",
      },
    ],
  },
} as const;

/** One onboarding action with a feature's value copy (shell-docs' card). */
export function IntelligenceOnboardingPrompt({
  scope,
  feature,
  surface,
}: {
  scope: DocsScope;
  feature: IntelligenceOnboardingFeature;
  surface: string;
}) {
  const content = FEATURE_COPY[feature] ?? FEATURE_COPY.threads;
  const pathname = usePathname();
  const headingId = useId();
  const Glyph = feature === "learning" ? LearningGlyph : ThreadsGlyph;

  return (
    <section
      aria-labelledby={headingId}
      data-feature={feature}
      data-surface={surface}
      className="not-prose my-6 rounded-xl border bg-card p-5"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-center gap-3 xl:mt-2.5">
          <Glyph className="size-[22px] shrink-0 text-foreground" aria-hidden />
          <h2
            id={headingId}
            className="text-xl font-semibold tracking-[-0.02em] text-foreground"
          >
            {content.title}
          </h2>
        </div>
        <DocsPromptActions
          scope={scope}
          surface={surface}
          copiedEvent={INTELLIGENCE_ONBOARDING_EVENTS.promptCopied}
          createPrompt={() => {
            const runId = createOnboardingRunId();
            return {
              text: createIntelligenceOnboardingPrompt(runId),
              analyticsProperties: {
                feature,
                from_path: pathname,
                onboarding_run_id: runId,
                surface,
              },
            };
          }}
        />
      </div>

      {feature === "learning" ? (
        <div className="mt-4 grid gap-3 border-t pt-3 text-sm leading-relaxed text-muted-foreground md:grid-cols-[1.4fr_1fr_1.25fr] md:gap-0">
          {content.points.map((point, index) => (
            <p
              key={point.label}
              className={index > 0 ? "md:border-s md:px-5" : "md:pe-5"}
            >
              <span className="font-semibold text-foreground">
                {point.label}
              </span>{" "}
              {point.body}
            </p>
          ))}
          <p className="md:border-s md:ps-5">
            <span className="font-semibold text-foreground">Build</span> a new
            agent or <span className="font-semibold text-foreground">bring</span>{" "}
            one you already have. Any frontend, any backend.
          </p>
        </div>
      ) : (
        <p className="mt-4 border-t pt-3 text-sm leading-relaxed text-muted-foreground">
          {content.points.map((point) => (
            <Fragment key={point.label}>
              <span className="font-semibold text-foreground">
                {point.label}
              </span>{" "}
              <span>{point.body} </span>
            </Fragment>
          ))}
        </p>
      )}
    </section>
  );
}
