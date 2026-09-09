"use client";

// DocsBuildWith — the homepage section "What you build with it".
//
// Four intents in the reader's language (the API name belongs on the
// destination page), each linking into the docs for the framework the page
// is currently scoped to.
//
// This section REFLECTS the framework; it never re-picks it. The single
// place the choice is made is the `#frameworks` grid further down the page
// (`DocsLandingNext`), and the muted line below the cards links there. A
// second inline picker would have to navigate: `SidebarFrameworkSelector`
// is already mounted on this page as the layout banner, and its
// `selectFramework` calls `router.replace(backendPathForCurrentPath(...))`,
// which leaves `/` rather than re-scoping in place.
//
// A client component, because the scope is a hook read. It imports the
// registry the way its sibling `DocsLandingNext` does — that component is a
// client module on this same route, so `registry.json` is already in this
// page's client bundle and resolving the display name here costs nothing
// extra.

import React from "react";
import Link from "next/link";
import { useFramework } from "./framework-provider";
import { ROOT_FRAMEWORK, getIntegration } from "@/lib/registry";

/**
 * The four intents, in the reader's language. `href` is written relative to
 * the framework scope: root-surface paths, which `scopedHref` prefixes for
 * any framework that is not served at the root.
 */
const BUILD_WITH_INTENTS: readonly {
  title: string;
  body: string;
  href: string;
}[] = [
  {
    title: "Add a chat surface",
    body: "Drop in a ready-made chat, sidebar, or popup.",
    href: "/prebuilt-components/chat",
  },
  {
    title: "Let the agent render UI",
    body: "Your agent returns real React components, not just text.",
    href: "/generative-ui",
  },
  {
    title: "Ask before acting",
    body: "Pause for the user's approval at the steps that matter.",
    href: "/human-in-the-loop",
  },
  {
    title: "Build your own interface",
    body: "Headless hooks, your pixels.",
    href: "/custom-look-and-feel/headless-ui",
  },
];

/** The id `DocsLandingNext` gives the framework grid this line links at. */
const FRAMEWORK_GRID_ANCHOR = "#frameworks";

/**
 * The docs for `ROOT_FRAMEWORK` are served at the root URL surface, so its
 * pages need no prefix; every other framework lives under `/<slug>/`. Same
 * rule the hero's quickstart options are built with in
 * `app/[[...slug]]/page.tsx`.
 */
function scopedHref(href: string, slug: string): string {
  return slug === ROOT_FRAMEWORK ? href : `/${slug}${href}`;
}

export function DocsBuildWith(): React.JSX.Element {
  const { framework, storedFramework, effectiveFramework, knownFrameworks } =
    useFramework();

  // Scope resolution, URL → remembered → default.
  //
  // On `/` the URL asserts no framework, so `framework` is null and
  // `effectiveFramework` is the default — which is exactly what the server
  // renders, and what the reader sees on first paint. `storedFramework` is
  // null during SSR and during the first client render (the provider reads
  // localStorage in an effect), so hydration matches the server markup
  // character for character; the remembered framework is layered on
  // afterwards. Same shape as `StoredFrameworkHighlight`, which layers the
  // remembered selection onto the server-rendered framework cards.
  //
  // So: a FIRST-TIME visitor sees "Scoped to CopilotKit's Built-in Agent."
  // with unprefixed links, and it never changes. A RETURNING visitor who
  // picked Mastra sees that same default for one frame and then the line
  // and all four links re-scope to Mastra. No placeholder, no empty state,
  // and no flash of a name that was never valid.
  //
  // `storedFramework` is advisory and unvalidated on read (an older build,
  // or a hand-edited localStorage, could hold a slug this docs site no
  // longer serves), so it only counts when the registry still knows it —
  // otherwise the name and the links would disagree.
  const remembered =
    storedFramework &&
    knownFrameworks.includes(storedFramework) &&
    getIntegration(storedFramework)
      ? storedFramework
      : null;
  const scope = framework ?? remembered ?? effectiveFramework;
  const scopeName = getIntegration(scope)?.name ?? scope;

  return (
    <section id="build-with" className="not-prose">
      <div className="mb-4 max-w-2xl">
        <h2 className="text-xl font-semibold tracking-tight text-[var(--text)] sm:text-2xl">
          What you build with it
        </h2>
      </div>

      {/* One column at 375px, two from `sm` — the cards stack rather than
          shrink, so this row never forces the page to scroll sideways. */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
        {BUILD_WITH_INTENTS.map((intent) => (
          <Link
            key={intent.href}
            href={scopedHref(intent.href, scope)}
            className="shell-docs-radius-surface group relative flex min-h-[72px] flex-col justify-start overflow-hidden border border-[var(--border)] bg-[var(--bg-elevated)]/30 p-3.5 no-underline transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg-surface)]"
          >
            <span className="block text-sm font-semibold leading-snug text-[var(--text)] transition-colors group-hover:text-[var(--accent)]">
              {intent.title}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-[var(--text-muted)]">
              {intent.body}
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">
        Scoped to {scopeName}.{" "}
        <Link
          href={FRAMEWORK_GRID_ANCHOR}
          className="text-[var(--accent)] underline-offset-2 hover:underline"
        >
          Change framework
        </Link>
      </p>
    </section>
  );
}
