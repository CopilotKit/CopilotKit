// DocsStart — the homepage section "Start", and the target of the hero's
// three path anchors.
//
// There is exactly ONE primary action here, on purpose. `copilotkit onboard`
// classifies the starting state itself (empty, agent-only, frontend-only,
// both, both-oss), so three per-path buttons would all copy the same
// canonical prompt and offer a choice that does not exist. The three paths
// are named once, below the actions, as reassurance rather than as routing.
//
// A server component: neither the heading nor the copy needs a hook, and the
// two actions are client components that bring their own `"use client"`.

import React from "react";
import { HeroOnboardingPromptButton } from "./hero-onboarding-prompt-button";
import { HeroStartActions, QuickstartLinkButton } from "./hero-start-commands";

// The hero links three in-page anchors at this id.
export const DOCS_START_SECTION_ID = "start";

// Follows the existing `docs_landing_*` surface naming, so this placement
// lands in the same PostHog funnel as `docs_landing_hero` and can be broken
// down against it.
const START_SURFACE = "docs_landing_start";

export function DocsStart(): React.JSX.Element {
  return (
    <section id={DOCS_START_SECTION_ID} className="not-prose">
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold tracking-tight text-[var(--text)] sm:text-2xl">
          Start
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          Copy one prompt. Your coding agent runs{" "}
          <code className="shell-docs-radius-icon border border-[var(--border)] bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[0.8125rem] text-[var(--text)]">
            copilotkit onboard
          </code>
          , which works out where you already are and takes the shortest path
          from there.
        </p>
      </div>

      {/* `HeroStartActions` already stacks the two buttons vertically below
          `sm` and lines them up side by side above it, so reusing it keeps
          this row free of horizontal overflow at 375px without new CSS. */}
      <div className="mt-5">
        <HeroStartActions
          prompt={<HeroOnboardingPromptButton surface={START_SURFACE} />}
          quickstart={
            <QuickstartLinkButton
              href="/quickstart"
              variant="secondary"
              label="Set it up manually"
              fromPath="/"
            />
          }
        />
      </div>

      <p className="mt-4 max-w-2xl text-xs leading-relaxed text-[var(--text-muted)]">
        Works whether you are starting from nothing · already have an app or an
        agent · or already run CopilotKit and want to add Intelligence.
      </p>
    </section>
  );
}
