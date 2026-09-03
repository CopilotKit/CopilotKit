"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLinkIcon,
  TextIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useCopyButton } from "fumadocs-ui/utils/use-copy-button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
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
  createOnboardingRunId,
  INTELLIGENCE_ONBOARDING_EVENTS,
} from "@/lib/intelligence-onboarding-prompt";
import ClaudeIcon from "@/components/icons/claude";
import ClaudeCodeIcon from "@/components/icons/claude-code";
import CodexIcon from "@/components/icons/codex";
import WindsurfIcon from "@/components/icons/windsurf";
import { getRuntimeConfig } from "@/lib/runtime-config.client";

/**
 * Resolve the canonical base URL on the client. Reads from
 * window.__SHOWCASE_CONFIG__ (populated by the root layout's inline
 * <script>) so non-production can reflect its runtime base URL without
 * rebuilding the artifact. Production runtime config always injects the
 * public canonical docs origin. The reader strips trailing slashes so callers
 * can concatenate `${BASE}${path}` safely.
 *
 * Still inlined here (rather than reaching into `@/lib/sitemap-helpers`)
 * because that module also pulls in `fs` / `path` / `gray-matter` for
 * sitemap generation — Node-only deps that fail the client bundle when
 * a `"use client"` component reaches for them.
 */
function getClientBaseUrl(): string {
  return getRuntimeConfig().baseUrl;
}

// Module-scoped cache of resolved markdown bodies. Survives navigations
// so repeated clicks on the same page don't re-fetch. Stored as the
// awaited STRING (not a Promise) to avoid the failed-fetch poisoning
// pattern where a rejected promise gets cached and replayed on every
// subsequent click — see `fetchMarkdown` below.
const cache = new Map<string, string>();

/** Fetch the markdown body for a docs URL, caching successful responses
 * only. Throws on network failure or non-2xx response so the click
 * handler can surface the error instead of silently copying a 404 page
 * body or replaying a permanently-broken cache entry. */
async function fetchMarkdown(url: string): Promise<string> {
  const cached = cache.get(url);
  if (cached !== undefined) return cached;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `fetchMarkdown: ${url} responded ${res.status} ${res.statusText}`,
    );
  }
  const body = await res.text();
  cache.set(url, body);
  return body;
}

/**
 * see https://fumadocs.dev/docs/integrations/llms#page-actions to customize.
 */
export function MarkdownCopyButton({
  markdownUrl,
  appearance = "button",
  ...props
}: ComponentProps<"button"> & {
  /**
   * A URL to fetch the raw Markdown/MDX content of page
   */
  markdownUrl: string;
  /** Render as a full-width popover action instead of standalone chrome. */
  appearance?: "button" | "menu-item";
}) {
  const [isLoading, setLoading] = useState(false);
  const pathname = usePathname();
  const posthog = usePostHog();
  const [checked, onClick] = useCopyButton(async () => {
    // Single code path for both cache-hit and cache-miss so the loader
    // state, error handling, and clipboard API stay consistent. The
    // upstream Fumadocs example uses two branches (writeText for hits,
    // ClipboardItem(promise) for misses), but the ClipboardItem promise
    // flow has spotty browser support (Safari, non-secure contexts) and
    // diverges from the simpler hit path for no benefit.
    setLoading(true);
    try {
      const body = await fetchMarkdown(markdownUrl);
      await navigator.clipboard.writeText(body);
      // Fire a dedicated event for the "Copy Markdown" affordance so
      // analytics can distinguish page-content copies from the global
      // CLI-command tracker (`cli_command_copied` in
      // `lib/track-command-copy.ts`), which intercepts every clipboard
      // write at the navigator level and classifies anything that
      // doesn't match an install command as `code` — not meaningful
      // for the new docs-as-context surface.
      posthog?.capture("markdown_copied", {
        path: pathname,
        markdown_url: markdownUrl,
      });
    } catch (err) {
      // Log AND re-throw. The throw is load-bearing: Fumadocs's
      // `useCopyButton` runs `Promise.resolve(callback()).then(setChecked(true))`
      // with NO `.catch()`. If we swallow here (return normally), the
      // outer `.then()` still fires and the button flips to its
      // checkmark state — the user sees a "copied!" indicator on a
      // failed copy and may paste stale or wrong content into the LLM
      // they're prompting. Re-throwing causes a single unhandled
      // promise rejection (browser console noise / Sentry entry) but
      // critically keeps the button in its idle state, which is the
      // correct visual feedback. A follow-up PR can introduce an
      // explicit error UI state to surface "Copy failed" to the user.
      console.error("[page-actions] Copy Markdown failed", markdownUrl, err);
      throw err;
    } finally {
      setLoading(false);
    }
  });

  return (
    <button
      // Spread caller props FIRST so the component-owned `disabled` and
      // `onClick` below take precedence over anything the caller passes
      // — those are load-bearing for the component's core behavior, and
      // a caller overriding them could silently break the loading guard
      // or the copy handler. `className` is MERGED (not overridden):
      // caller-supplied tokens are passed through `cn(..., props.className)`
      // so authors can add layout/styling tweaks alongside the variant.
      {...props}
      disabled={isLoading}
      onClick={onClick}
      className={cn(
        appearance === "menu-item"
          ? "shell-docs-radius-control inline-flex w-full items-center gap-2 p-2 text-left text-sm font-normal text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:text-[var(--text-muted)]"
          : buttonVariants({
              color: "secondary",
              size: "sm",
              className:
                "gap-2 [&_svg]:size-3.5 [&_svg]:text-[var(--text-muted)]",
            }),
        props.className,
      )}
    >
      {checked ? <Check /> : <Copy />}
      {props.children ?? "Copy Markdown"}
    </button>
  );
}

type OnboardingCopyState = "idle" | "copied" | "error";

/**
 * One name for one surface. Used BOTH as the `surface` property of the
 * analytics event and as the `data-docs-copy-surface` attribute the global
 * copy tracker reads, so a breakdown on either resolves to the same row.
 * `docs_`-prefixed snake_case matches every other surface value in the app
 * (`docs_landing_learning` in `app/[[...slug]]/page.tsx`,
 * `CHANNELS_ACTIVATION_SURFACES` in `lib/channels-activation-contracts.ts`).
 */
const ONBOARDING_COPY_SURFACE = "docs_page_tools_onboarding_prompt";

/**
 * Copies the canonical CopilotKit onboarding prompt so a reader can paste it
 * straight into their coding agent.
 *
 * The copied string is `createIntelligenceOnboardingPrompt(runId)` followed by
 * three sentences of page context: which agent framework the reader is reading
 * about, which frontend they have selected, and which page they copied from.
 * All three are statements of fact for the receiving agent, never instructions
 * — the prompt itself is the only thing that tells the agent what to do, and
 * the sibling copies in the Intelligence repo and the Inspector have to keep
 * matching that part byte for byte.
 *
 * Framework before frontend because that is the order the CLI's graph works
 * in: it settles the agent framework first, then the frontend. Each sentence
 * leads with its own subject and can be "" independently, so all four
 * combinations read correctly.
 *
 * The run id is minted per click (not per page load), matching
 * `components/intelligence-onboarding-prompt.tsx`: one clipboard write is one
 * onboarding attempt, and the CLI reports the same id back, so hoisting it
 * would collapse many attempts into one funnel row.
 */
export function OnboardingPromptCopyButton({
  framework,
  frontend,
  markdownUrl,
  ...props
}: ComponentProps<"button"> & {
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
   */
  markdownUrl: string;
}) {
  const pathname = usePathname();
  const posthog = usePostHog();
  const [copyState, setCopyState] = useState<OnboardingCopyState>("idle");
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
    // Ignore clicks while a write is still pending. Two writes would mint two
    // run ids and report two copies, but only the last one survives on the
    // clipboard, so the CLI can close out at most one of them and the other
    // stays an open funnel row forever — exactly what the per-click run id
    // exists to prevent.
    if (copyInFlightRef.current) return;
    copyInFlightRef.current = true;
    setIsCopying(true);

    const generation = (copyGenerationRef.current += 1);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
    setCopyState("idle");

    const runId = createOnboardingRunId();

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
    // render: on the server it returns the SSR placeholder (see the module
    // comment on that function), so a render-time read would put a different
    // URL in the server HTML than in the hydrated client and mismatch.
    // Trailing slash trimmed because `markdownUrl` already leads with one.
    const pageUrl = `${getClientBaseUrl().replace(/\/+$/, "")}${markdownUrl}`;
    // Stands on its own when both sentences above are "", which is why it
    // names the page rather than referring back to it.
    const pageSentence = ` The developer copied this prompt from ${pageUrl}.`;

    try {
      await navigator.clipboard.writeText(
        createIntelligenceOnboardingPrompt(runId) +
          frameworkSentence +
          frontendSentence +
          pageSentence,
      );
    } catch (err) {
      // Unlike `MarkdownCopyButton` there is no `useCopyButton` hook to
      // signal, so the rejection is handled here and NOT re-thrown. No
      // analytics either: a run id that never reached a clipboard would
      // report an onboarding attempt the CLI can never close out. It is still
      // logged, so a blocked copy is at least observable in the console.
      console.error("[page-actions] Copy agent prompt failed", err);
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
        onboarding_run_id: runId,
        // No `feature` property: every other emitter of this event sends a
        // value of the `IntelligenceOnboardingFeature` union
        // ("learning" | "threads"), and this button is neither. The
        // distinction it would carry lives in `surface` instead.
        surface: ONBOARDING_COPY_SURFACE,
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
        // in the page-tools row that should count as this surface, and its
        // two neighbours copy something else entirely.
        data-docs-copy-surface={ONBOARDING_COPY_SURFACE}
        disabled={isCopying}
        onClick={copyPrompt}
        className={cn(
          buttonVariants({
            // Page reading is the primary task. Keep this useful action at the
            // same visual weight as its neighbours so it does not compete with
            // the article title for attention.
            color: "secondary",
            size: "sm",
            className: "gap-2 [&_svg]:size-3.5",
          }),
          props.className,
        )}
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
        {copyState === "error"
          ? "Copy blocked"
          : (props.children ?? "Copy agent prompt")}
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

/**
 * see https://fumadocs.dev/docs/integrations/llms#page-actions to customize.
 */
export function ViewOptionsPopover({
  markdownUrl,
  githubUrl,
  condensed = false,
  includeCopyPage = false,
  ...props
}: ComponentProps<typeof PopoverTrigger> & {
  /**
   * A URL to the raw Markdown/MDX content of page
   */
  markdownUrl?: string;

  /**
   * Source file URL on GitHub
   */
  githubUrl?: string;

  /** Use an icon-only trigger designed to join a split primary action. */
  condensed?: boolean;

  /** Put the Markdown copy action at the top of the condensed menu. */
  includeCopyPage?: boolean;
}) {
  const pathname = usePathname();
  const posthog = usePostHog();
  const items = useMemo(() => {
    // Build the absolute URL deterministically from `getClientBaseUrl()`
    // so SSR and the first client render agree. The previous
    // `typeof window === "undefined" ? pathname : new URL(pathname, ...)`
    // branch produced a relative path on the server and an absolute URL
    // on the client, causing a React hydration mismatch on every
    // popover anchor AND embedding a path-only URL ("Read /quickstart,
    // I want to ask...") into the LLM-app deep-link prompt — which the
    // target LLM can't resolve.
    const pageUrl = `${getClientBaseUrl()}${pathname}`;
    const q = `Read ${pageUrl}, I want to ask questions about it.`;

    return [
      githubUrl && {
        title: "Open in GitHub",
        target: "github",
        href: githubUrl,
        icon: (
          <svg fill="currentColor" role="img" viewBox="0 0 24 24">
            <title>GitHub</title>
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
        ),
      },
      !condensed && markdownUrl && {
        title: "View as Markdown",
        target: "view-as-markdown",
        href: markdownUrl,
        icon: <TextIcon />,
      },
      {
        title: "Open in Windsurf",
        target: "windsurf",
        href: `windsurf://cascade/newChat?${new URLSearchParams({
          prompt: q,
        })}`,
        icon: <WindsurfIcon />,
      },
      {
        title: "Open in Claude Code",
        target: "claude-code",
        href: `claude-cli://open?${new URLSearchParams({
          q,
        })}`,
        icon: <ClaudeCodeIcon />,
      },
      {
        title: "Open in Codex",
        target: "codex",
        href: `https://chatgpt.com/codex?${new URLSearchParams({
          prompt: q,
        })}`,
        icon: <CodexIcon />,
      },
      {
        title: "Open in ChatGPT",
        target: "chatgpt",
        href: `https://chatgpt.com/?${new URLSearchParams({
          hints: "search",
          q,
        })}`,
        icon: (
          <svg
            role="img"
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>OpenAI</title>
            <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
          </svg>
        ),
      },
      {
        title: "Open in Claude",
        target: "claude",
        href: `https://claude.ai/new?${new URLSearchParams({
          q,
        })}`,
        icon: <ClaudeIcon />,
      },
      {
        title: "Open in Cursor",
        target: "cursor",
        icon: (
          <svg
            fill="currentColor"
            role="img"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Cursor</title>
            <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" />
          </svg>
        ),
        href: `https://cursor.com/link/prompt?${new URLSearchParams({
          text: q,
        })}`,
      },
    ].filter((v) => !!v);
  }, [condensed, githubUrl, markdownUrl, pathname]);

  return (
    <Popover>
      <PopoverTrigger
        {...props}
        aria-label={
          condensed
            ? (props["aria-label"] ?? "More page actions")
            : props["aria-label"]
        }
        className={cn(
          buttonVariants({
            color: "secondary",
            size: "sm",
          }),
          "gap-2 data-[state=open]:border-[var(--accent)] data-[state=open]:bg-[var(--accent-dim)] data-[state=open]:text-[var(--accent)]",
          condensed && "docs-page-actions-trigger",
          props.className,
        )}
      >
        {!condensed && (props.children ?? "Open")}
        <ChevronDown className="size-3.5 text-[var(--text-muted)]" />
      </PopoverTrigger>
      <PopoverContent
        align={condensed ? "end" : "center"}
        className={cn("flex flex-col", condensed && "w-72 p-1.5")}
      >
        {includeCopyPage && markdownUrl && (
          <>
            <MarkdownCopyButton
              markdownUrl={markdownUrl}
              appearance="menu-item"
              title="Copy page as Markdown"
            >
              Copy page
            </MarkdownCopyButton>
            <div
              role="separator"
              aria-orientation="horizontal"
              className="mx-2 my-1 border-t border-[var(--border)]"
            />
          </>
        )}
        {items.map((item) => (
          <a
            key={item.href}
            href={item.href}
            rel="noreferrer noopener"
            target="_blank"
            // item.href embeds `getClientBaseUrl()` (the SSR placeholder
            // during server-render, real value post-hydration), so React
            // would log a hydration mismatch on every popover anchor.
            // Suppression scopes to this attribute mismatch only.
            suppressHydrationWarning
            // Fire a PostHog event keyed by `target` (github, windsurf,
            // claude, chatgpt, codex, view-as-markdown, etc.) so the
            // analytics dashboard can attribute LLM-routing intent to
            // specific docs pages. Capture runs synchronously before
            // navigation; PostHog buffers and flushes async, so the new
            // tab opens without waiting on the network.
            onClick={() =>
              posthog?.capture("open_in_llm_clicked", {
                target: item.target,
                path: pathname,
              })
            }
            className="shell-docs-radius-control inline-flex items-center gap-2 p-2 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] [&_svg]:size-4"
          >
            {item.icon}
            {item.title}
            <ExternalLinkIcon className="ms-auto size-3.5 text-[var(--text-muted)]" />
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
}
