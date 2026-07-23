import React from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type * as PageTree from "fumadocs-core/page-tree";
import { MobileTopNav } from "./mobile-top-nav";
import { SidebarScrollPreserver } from "./sidebar-scroll-preserver";
import { SidebarFolderStatePreserver } from "./sidebar-folder-state-preserver";
import { SidebarReactDocsNotice } from "./sidebar-react-docs-notice";
import GithubIcon from "./icons/github";
import DiscordIcon from "./icons/discord";
import { MobileSidebarFooterTalk } from "./mobile-sidebar-footer-talk";
import { PrimaryDocsTabs } from "./primary-docs-tabs";

// Shared Fumadocs `DocsLayout` chrome used by every shell-docs route.
// All five callers (home overview, framework root, framework-scoped MDX
// via DocsPageView, /reference, /ag-ui) pass the same nav/search/sidebar
// config — only `tree` and `sidebar.banner` vary. Centralizing keeps
// sidebar behavior, mobile nav slot, and container className from drifting
// across routes when one is tweaked.
export function ShellDocsLayout({
  tree,
  banner,
  sidebarClassName,
  children,
}: {
  tree: PageTree.Root;
  banner?: React.ReactNode;
  sidebarClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <DocsLayout
      tree={tree}
      nav={{ component: <MobileTopNav /> }}
      searchToggle={{ enabled: false }}
      // Suppress fumadocs's auto-injected ThemeSwitch — `slots.themeSwitch`
      // is populated by default even when `themeSwitch` isn't passed, so
      // we have to pass `enabled: false` explicitly to keep the
      // `iconLinks.length > 0 || slots.themeSwitch` branch in
      // `sidebar.js` from rendering the default rounded pill. Our own
      // single-toggle `<ThemeSwitch>` is mounted in BrandNav instead.
      themeSwitch={{ enabled: false }}
      // We intentionally do NOT pass `links` here either. Fumadocs would
      // funnel `type: "icon"` entries into the same auto-injected pill
      // we just disabled — but the icons need to live in our custom
      // footer row anyway. Rendering them inline keeps a single source
      // of truth (the JSX below) and avoids the auto layout fighting
      // our custom one.
      sidebar={{
        banner: (
          <div key="shell-docs-sidebar-banner" className="flex flex-col">
            <PrimaryDocsTabs className="shell-docs-mobile-sidebar-tabs" />
            {banner}
          </div>
        ),
        // Hide Fumadocs's collapse toggle — shell-docs has its own chrome.
        collapsible: false,
        className: ["shell-docs-sidebar", sidebarClassName]
          .filter(Boolean)
          .join(" "),
        // Note: `key` is required here because fumadocs's Sidebar
        // passes the `footer` ReactNode into a `jsxs(children: [a, b,
        // footer])` array, and React's dev-mode warning insists every
        // top-level child of an array carry a stable key. We don't
        // control fumadocs's render, so we hand it a keyed element
        // directly. The key is a literal string — there's only ever
        // one footer per sidebar.
        footer: (
          <div
            key="shell-docs-sidebar-footer"
            className="flex w-full flex-col gap-2 sidebar-footer-row md:w-auto md:flex-row md:items-center md:gap-1"
          >
            <MobileSidebarFooterTalk />
            <div className="flex items-center gap-1">
              <a
                href="https://github.com/copilotkit/copilotkit"
                target="_blank"
                rel="noreferrer noopener"
                aria-label="GitHub"
                className="shell-docs-radius-control inline-flex h-7 w-7 items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] [&_svg]:size-4"
              >
                <GithubIcon />
              </a>
              <a
                href="https://discord.gg/6dffbvGU3D"
                target="_blank"
                rel="noreferrer noopener"
                aria-label="Discord"
                className="shell-docs-radius-control inline-flex h-7 w-7 items-center justify-center text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] [&_svg]:size-4"
              >
                <DiscordIcon />
              </a>
            </div>
          </div>
        ),
      }}
      containerProps={{
        // The outer .docs-content-wrapper gradient + scroll behavior is
        // applied to DocsLayout's container so the scroll context, border,
        // and gradient match what shell-docs has always rendered.
        className: "docs-content-wrapper",
      }}
    >
      {/* Preserve sidebar scroll across navigations — the sidebar is
       * rendered per-page (this layout sits inside each page component
       * rather than in a Next.js layout file), so without explicit
       * restoration the Radix ScrollAreaViewport resets to 0 every
       * time the user clicks a link further down the list. */}
      <SidebarScrollPreserver />
      {/* Persist sidebar folder open/closed state across navigations —
       * without this, Fumadocs resets each Radix Collapsible to its
       * default state on every page mount, undoing the user's
       * "I want this section hidden" choice. */}
      <SidebarFolderStatePreserver />
      <SidebarReactDocsNotice />
      {children}
    </DocsLayout>
  );
}
