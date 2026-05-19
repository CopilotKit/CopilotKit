import React from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type * as PageTree from "fumadocs-core/page-tree";
import { MobileTopNav } from "./mobile-top-nav";
import { SidebarScrollPreserver } from "./sidebar-scroll-preserver";
import GithubIcon from "./icons/github";
import DiscordIcon from "./icons/discord";

// Shared Fumadocs `DocsLayout` chrome used by every shell-docs route.
// All five callers (home overview, framework root, framework-scoped MDX
// via DocsPageView, /reference, /ag-ui) pass the same nav/search/sidebar
// config — only `tree` and `sidebar.banner` vary. Centralizing keeps the
// sidebar surface, mobile nav slot, and container className from drifting
// across routes when one is tweaked.
export function ShellDocsLayout({
  tree,
  banner,
  children,
}: {
  tree: PageTree.Root;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <DocsLayout
      tree={tree}
      nav={{ component: <MobileTopNav /> }}
      searchToggle={{ enabled: false }}
      // `links` with `type: "icon"` get filtered into Fumadocs's
      // `iconLinks` bucket and render in the same sidebar-footer row
      // as the built-in theme switch, so GitHub + Discord sit on the
      // left and the toggle pushes to the right via Fumadocs's
      // `ms-auto`. Cleaner than a custom footer that has to fight
      // with the auto-injected theme toggle for the same row.
      links={[
        {
          type: "icon",
          icon: <GithubIcon />,
          text: "GitHub",
          url: "https://github.com/copilotkit/copilotkit",
          external: true,
        },
        {
          type: "icon",
          icon: <DiscordIcon />,
          text: "Discord",
          url: "https://discord.gg/6dffbvGU3D",
          external: true,
        },
      ]}
      sidebar={{
        banner,
        // Hide Fumadocs's collapse toggle — shell-docs has its own chrome.
        collapsible: false,
        className:
          "rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-sm shell-docs-sidebar",
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
      {children}
    </DocsLayout>
  );
}
