"use client";
import { useMemo, useState } from "react";
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
import ClaudeIcon from "@/components/icons/claude";
import ClaudeCodeIcon from "@/components/icons/claude-code";
import CodexIcon from "@/components/icons/codex";
import WindsurfIcon from "@/components/icons/windsurf";
import { getRuntimeConfig } from "@/lib/runtime-config.client";

/**
 * Resolve the canonical base URL on the client. Reads from
 * window.__SHOWCASE_CONFIG__ (populated by the root layout's inline
 * <script>) so the rendered absolute URL reflects the current deploy's
 * NEXT_PUBLIC_BASE_URL without rebuilding the artifact. The runtime
 * reader already strips trailing slashes so callers can concatenate
 * `${BASE}${path}` safely.
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
  ...props
}: ComponentProps<"button"> & {
  /**
   * A URL to fetch the raw Markdown/MDX content of page
   */
  markdownUrl: string;
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
        buttonVariants({
          color: "secondary",
          size: "sm",
          className:
            "gap-2 [&_svg]:size-3.5 [&_svg]:text-[var(--muted-foreground)]",
        }),
        props.className,
      )}
    >
      {checked ? <Check /> : <Copy />}
      {props.children ?? "Copy Markdown"}
    </button>
  );
}

/**
 * see https://fumadocs.dev/docs/integrations/llms#page-actions to customize.
 */
export function ViewOptionsPopover({
  markdownUrl,
  githubUrl,
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
      markdownUrl && {
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
  }, [githubUrl, markdownUrl, pathname]);

  return (
    <Popover>
      <PopoverTrigger
        {...props}
        className={cn(
          buttonVariants({
            color: "secondary",
            size: "sm",
          }),
          "gap-2 data-[state=open]:border-[var(--brand-accent)] data-[state=open]:bg-[var(--accent-dim)] data-[state=open]:text-[var(--brand-accent)]",
          props.className,
        )}
      >
        {props.children ?? "Open"}
        <ChevronDown className="size-3.5 text-[var(--muted-foreground)]" />
      </PopoverTrigger>
      <PopoverContent className="flex flex-col">
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
            className="shell-docs-radius-control inline-flex items-center gap-2 p-2 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] [&_svg]:size-4"
          >
            {item.icon}
            {item.title}
            <ExternalLinkIcon className="ms-auto size-3.5 text-[var(--muted-foreground)]" />
          </a>
        ))}
      </PopoverContent>
    </Popover>
  );
}
