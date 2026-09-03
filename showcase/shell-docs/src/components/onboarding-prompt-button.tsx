"use client";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonVariants } from "@/components/ui/button";
import { usePathname } from "fumadocs-core/framework";
import { usePostHog } from "posthog-js/react";
import {
  frameworkPromptSuffix,
  onboardingFrameworkSlug,
} from "@/lib/intelligence-onboarding-framework";
import {
  frontendPromptSuffix,
  onboardingFrontendSlug,
} from "@/lib/intelligence-onboarding-frontend";
import {
  createIntelligenceOnboardingPrompt,
  INTELLIGENCE_ONBOARDING_EVENTS,
} from "@/lib/intelligence-onboarding-prompt";
import { getClientBaseUrl } from "@/lib/client-base-url";
import { useOnboardingRunId } from "@/lib/hooks/use-onboarding-run-id";

type OnboardingCopyState = "idle" | "copied" | "error";

/**
 * Which surface's appearance the button wears. `compact` is the button in the
 * docs page-tools row; `hero` is the large one that leads a page.
 */
export type OnboardingPromptButtonVariant = "compact" | "hero";

/**
 * The page-tools row's classes: the primary action of a row whose other
 * members are deliberately `secondary`, at the size that keeps their heights
 * equal.
 */
const COMPACT_CLASSNAME = cn(
  buttonVariants({ color: "primary", size: "sm" }),
  "gap-2 [&_svg]:size-3.5",
);

/**
 * The hero's classes, carried over from the hero button this component
 * replaces, so the surfaces that already render it keep their pixels. Written
 * out rather than composed from `buttonVariants` because the hero disagrees
 * with that recipe on nearly every axis it shares — its own height, horizontal
 * padding, weight, shadow and focus ring, plus the full-width-until-`sm`
 * behaviour that lets it stack above the Quickstart button on a phone.
 * Expressing it as overrides would spell out the same literal twice and lean
 * on class-merge precedence to cancel the half of the recipe that does not
 * apply.
 *
 * Two additions to that literal. `[&_svg]:size-4` reproduces the `h-4 w-4` the
 * old hero put on the icon element itself: this component renders the icon
 * without a className, and lucide-react defaults to 24px, so the size has to
 * travel with the appearance — which is how the compact branch already does
 * it. And the `disabled:` pair, because this component disables the button
 * while a write is in flight and the old hero, having no disabled state, never
 * styled one.
 */
const HERO_CLASSNAME =
  "shell-docs-primary-cta shell-docs-radius-control inline-flex h-11 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border border-[var(--accent)] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--primary-foreground)] shadow-[var(--shadow-control)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 sm:w-fit [&_svg]:size-4";

function variantClassName(variant: OnboardingPromptButtonVariant): string {
  if (variant === "hero") {
    return HERO_CLASSNAME;
  }
  return COMPACT_CLASSNAME;
}

/**
 * Copies the canonical CopilotKit onboarding prompt so a reader can paste it
 * straight into their coding agent. One component for every surface that
 * offers that copy, told apart by `variant` and named apart by `surface`.
 *
 * The copied string is `createIntelligenceOnboardingPrompt(runId)` followed by
 * up to three sentences of page context: which agent framework the reader is
 * reading about, which frontend they have selected, and which page they copied
 * from. All three are statements of fact for the receiving agent, never
 * instructions — the prompt itself is the only thing that tells the agent what
 * to do, and the sibling copies in the Intelligence repo and the Inspector
 * have to keep matching that part byte for byte.
 *
 * Framework before frontend because that is the order the CLI's graph works
 * in: it settles the agent framework first, then the frontend. Each sentence
 * leads with its own subject and can be "" independently, so every
 * combination reads correctly — including all three absent, which copies the
 * canonical prompt alone.
 *
 * The run id comes from `useOnboardingRunId()` (see that hook for the
 * per-mount rationale) and every click of that button reuses it.
 */
export function OnboardingPromptButton({
  variant,
  surface,
  framework,
  frontend,
  markdownUrl,
  ...props
}: ComponentProps<"button"> & {
  /** Which surface's appearance to wear. */
  variant: OnboardingPromptButtonVariant;
  /**
   * One name for one surface. Used BOTH as the `surface` property of the
   * analytics event and as the `data-docs-copy-surface` attribute the global
   * copy tracker reads, so a breakdown on either resolves to the same row.
   */
  surface: string;
  /**
   * The agent framework this docs page is about: `slug` is the docs registry
   * slug, `name` the display name. On the root surface and in the cookbook
   * that is the Built-in Agent.
   *
   * Optional, because a docs surface can exist without a registry record to
   * name — `a2a` and `agent-spec` are documented like frameworks but are not
   * registered as integrations. Such a page still gets the button: the prompt
   * simply names no framework, and the CLI's graph inspects the repository
   * and asks, which is what it does anyway. Frameworks the graph has no node
   * for are handled downstream by `frameworkPromptSuffix`.
   */
  framework?: { slug: string; name: string };
  /**
   * The frontend the docs URL selects: `id` is the docs frontend id, `name`
   * its display name. Resolved server-side from the pathname by
   * `onboardingFrontendFor` and passed in — never derived here from
   * `usePathname()` — so the prompt names what the URL asserts rather than
   * what this component happens to observe after a navigation.
   *
   * Optional for the same reason `framework` is: a surface that has no
   * frontend to name still gets the button, and the prompt simply names none.
   * Frontends the graph has no node for (`slack`, `teams`) are handled
   * downstream by `frontendPromptSuffix`.
   */
  frontend?: { id: string; name: string };
  /**
   * The page's `.mdx` URL as a site-root-relative path — the same value the
   * page-tools row hands `MarkdownCopyButton`. Passed in rather than derived
   * from `usePathname()` so the URL named in the prompt and the URL the
   * neighbouring button fetches can never drift apart.
   *
   * Optional, because a surface that is not a docs page has no `.mdx` file to
   * name; the prompt then simply names no page.
   */
  markdownUrl?: string;
}) {
  const pathname = usePathname();
  const posthog = usePostHog();
  const [copyState, setCopyState] = useState<OnboardingCopyState>("idle");
  const getRunId = useOnboardingRunId();
  // Mirrors `MarkdownCopyButton`'s `isLoading`: the button is disabled while a
  // clipboard write is pending. The ref is the actual guard — a double-click
  // delivers both events before React re-renders, so both handlers would still
  // read `false` from the state.
  const [isCopying, setIsCopying] = useState(false);
  const copyInFlightRef = useRef(false);
  // Timer/generation bookkeeping mirrors `rich-threads-setup-prompt.tsx`: a
  // pending reset from an earlier click must never resurrect "idle" over the
  // label a later click just set, and no timer may fire after unmount.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      copyGenerationRef.current += 1;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    };
  }, []);

  function scheduleReset(generation: number, delayMs: number) {
    resetTimerRef.current = setTimeout(() => {
      if (mountedRef.current && generation === copyGenerationRef.current) {
        setCopyState("idle");
        resetTimerRef.current = null;
      }
    }, delayMs);
  }

  async function copyPrompt() {
    // Ignore clicks while a write is still pending. The two writes now carry
    // the same run id, so a double-click would report one onboarding attempt
    // twice — one attempt reported as two, which double-counts the reader in
    // the funnel.
    if (copyInFlightRef.current) return;
    copyInFlightRef.current = true;
    setIsCopying(true);

    const generation = (copyGenerationRef.current += 1);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
    setCopyState("idle");

    const effectiveRunId = getRunId();

    // Reused verbatim from the hero button's helper so both surfaces name the
    // framework in the same words. It is "" for a framework the CLI's
    // onboarding graph has no node for (`langroid`, `spring-ai`, …), which
    // leaves the framework unnamed rather than promising a path the CLI
    // cannot walk.
    const frameworkSentence = framework
      ? frameworkPromptSuffix(framework.slug, framework.name)
      : "";
    // Built the same way, from the frontend the URL selects, and appended
    // after the framework sentence because the graph settles the framework
    // first. "" for `slack` and `teams`, which are channels the graph has no
    // frontend node for.
    const frontendSentence = frontend
      ? frontendPromptSuffix(frontend.id, frontend.name)
      : "";
    // `getClientBaseUrl()` is read HERE, inside the handler, and never during
    // render: on the server it returns the SSR placeholder (see that
    // function's own comment), so a render-time read would put a different
    // URL in the server HTML than in the hydrated client and mismatch.
    // Stands on its own when both sentences above are "", which is why it
    // names the page rather than referring back to it.
    const pageSentence = markdownUrl
      ? ` The developer copied this prompt from ${getClientBaseUrl()}${markdownUrl}.`
      : "";

    try {
      await navigator.clipboard.writeText(
        createIntelligenceOnboardingPrompt(effectiveRunId) +
          frameworkSentence +
          " " +
          frontendSentence +
          pageSentence,
      );
    } catch (err) {
      // Unlike `MarkdownCopyButton` there is no `useCopyButton` hook to
      // signal, so the rejection is handled here and NOT re-thrown. No
      // analytics either: a run id that never reached a clipboard would
      // report an onboarding attempt the CLI can never close out. It is still
      // logged, so a blocked copy is at least observable in the console.
      console.error("[onboarding-prompt-button] Copy agent prompt failed", err);
      if (!mountedRef.current || generation !== copyGenerationRef.current) {
        return;
      }
      setCopyState("error");
      scheduleReset(generation, 2600);
      return;
    } finally {
      // Release the guard on BOTH paths, so a rejected write cannot leave the
      // button permanently disabled.
      copyInFlightRef.current = false;
      if (mountedRef.current) setIsCopying(false);
    }

    // The graph slug, not the docs slug, so this property joins the value the
    // CLI records for the same run. Left off the payload entirely when the
    // graph has no equivalent, rather than sent as a placeholder that would
    // pollute breakdowns — same rule as the hero button.
    const graphFramework = framework
      ? onboardingFrameworkSlug(framework.slug)
      : undefined;
    // Same rule for the frontend, under the matching property name: the graph
    // slug, and omitted entirely when the graph has no equivalent.
    const graphFrontend = frontend
      ? onboardingFrontendSlug(frontend.id)
      : undefined;

    try {
      posthog?.capture(INTELLIGENCE_ONBOARDING_EVENTS.promptCopied, {
        from_path: pathname,
        onboarding_run_id: effectiveRunId,
        // No `feature` property: every other emitter of this event sends a
        // value of the `IntelligenceOnboardingFeature` union
        // ("learning" | "threads"), and this button is neither. The
        // distinction it would carry lives in `surface` instead.
        surface,
        ...(graphFramework ? { agent_framework: graphFramework } : {}),
        ...(graphFrontend ? { frontend: graphFrontend } : {}),
      });
    } catch {
      // Analytics must never break the copy the reader actually asked for.
    }

    if (!mountedRef.current || generation !== copyGenerationRef.current) {
      return;
    }
    setCopyState("copied");
    scheduleReset(generation, 1800);
  }

  // One label set for both appearances: the idle label a caller may override
  // through `children`, and the failure label that replaces it.
  const idleLabel = props.children ?? "Copy agent prompt";
  const label = copyState === "error" ? "Copy blocked" : idleLabel;

  return (
    <>
      <button
        type="button"
        // Caller props first so the component-owned handler and the
        // conversion-surface attribute below cannot be clobbered.
        {...props}
        // The global tracker in `lib/providers/copy-tracker.tsx` resolves the
        // surface via `document.activeElement.closest(...)`, which walks up
        // the ancestor chain — a wrapper would work too (see
        // `react/docs-conversion.tsx` and `rich-threads-setup-prompt.tsx`).
        // It sits on the button deliberately: this button is the only element
        // of its surface that should count as that surface, and anything
        // beside it copies something else entirely.
        data-docs-copy-surface={surface}
        disabled={isCopying}
        onClick={copyPrompt}
        className={cn(variantClassName(variant), props.className)}
      >
        {copyState === "copied" ? (
          <Check aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
        {/* Success swaps only the icon, matching `MarkdownCopyButton` right
            next to it. A "Copied" label is ~45px narrower than the idle one,
            so it would slide the two neighbours leftward under the reader's
            cursor for 1800ms and back, and can un-wrap and re-wrap the row
            near the mobile breakpoint. Failure keeps its label change: it is
            rare, and the reader needs to be told the copy did not happen.
            Either way the `aria-live` region below announces the outcome,
            which is what a screen reader gets instead of the icon. */}
        {variant === "hero" ? (
          /* The status labels are far shorter than the idle one, so rendering
             only the active label collapses this button and shunts the
             Quickstart button beside it sideways mid-interaction. Stack all
             labels in one grid cell and keep the longest one in the layout
             (invisible) so the width is reserved without a magic pixel
             value. */
          <span className="grid">
            <span
              aria-hidden="true"
              className="invisible col-start-1 row-start-1"
            >
              {idleLabel}
            </span>
            <span className="col-start-1 row-start-1">{label}</span>
          </span>
        ) : (
          label
        )}
      </button>
      <span aria-live="polite" className="sr-only">
        {copyState === "copied"
          ? "Prompt copied"
          : copyState === "error"
            ? "Prompt copy failed. Try again."
            : ""}
      </span>
    </>
  );
}
