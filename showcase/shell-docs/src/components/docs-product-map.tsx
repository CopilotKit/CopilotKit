// DocsProductMap — the server-rendered shell of the docs homepage product
// map. Composes the four blocks (Frontend, CopilotKit, Intelligence, Agent)
// and their three connectors from `./docs-map-parts` and `@/lib/homepage-map`.
//
// This must stay a plain, synchronous server component with no `"use client"`
// directive and no hook: it imports `getIntegrations` from `@/lib/registry`,
// which pulls in `src/data/registry.json` (~646 KB, see registry.ts lines
// 137-146) — a cost client bundles must never pay. The only piece of this
// page that needs a hook is the six CopilotKit tiles scoped to the reader's
// remembered framework, and that already lives in the client leaf
// `./docs-map-scoped-capabilities`, composed here as a child. Same split as
// `stored-framework-highlight.tsx`: the server renders the shell, a small
// client component layers the remembered value on top.

import React from "react";

import {
  CapabilityTile,
  MAP_TILE_GRID_CLASS,
  MapBlock,
  MapConnector,
  PickGrid,
} from "./docs-map-parts";
import { ScopedCapabilities } from "./docs-map-scoped-capabilities";
import {
  COPILOTKIT_CAPABILITIES,
  INTELLIGENCE_CAPABILITIES,
  agentPicks,
  frontendPicks,
  scopedHref,
} from "@/lib/homepage-map";
import { getIntegrations } from "@/lib/registry";

/**
 * Anchor id for the Agent block, the destination of "Change framework" in
 * `ScopedCapabilities`. Exported from here (rather than from
 * `docs-map-parts` or `homepage-map`) because the route imports
 * `DocsProductMap` from this file and has no other reason to reach into the
 * map's internals.
 */
export const DOCS_MAP_FRAMEWORKS_ANCHOR = "frameworks";

export function DocsProductMap(): React.JSX.Element {
  // The validation set for a remembered framework slug. Built from every
  // known integration — not filtered by `docs_mode` — because this record
  // exists only to answer "is this slug still one we know about", the same
  // reach the old `getIntegration(slug)` lookup had. `scopedHref("", slug)`
  // yields exactly that framework's href prefix (`""` for the root
  // framework, `/<slug>` otherwise), so the URL rule itself stays owned by
  // `homepage-map.ts` alone.
  const frameworks = Object.fromEntries(
    getIntegrations().map((integration) => [
      integration.slug,
      { name: integration.name, hrefPrefix: scopedHref("", integration.slug) },
    ]),
  );

  return (
    <>
      <MapBlock
        variant="choice"
        nameSize="sm"
        kicker="Bring your own · your choice"
        name="Frontend"
        description="CopilotKit ships the same primitives for every one of these. Pick the one you already use — nothing else on this page changes."
      >
        <PickGrid picks={frontendPicks()} />
      </MapBlock>

      <MapConnector variant="plain" />

      <MapBlock
        variant="core"
        kicker="Open source · the product"
        name="CopilotKit"
        description="The SDK in your app and the runtime on your server. Everything your users actually touch, running entirely on your side."
        // Deliberately unscoped: the spec scopes only the six capability
        // tiles below, and this block header is server-rendered with no
        // access to the reader's remembered framework.
        action={{ label: "Quickstart", href: "/quickstart" }}
      >
        <ScopedCapabilities
          capabilities={COPILOTKIT_CAPABILITIES}
          anchorId={DOCS_MAP_FRAMEWORKS_ANCHOR}
          frameworks={frameworks}
        />
      </MapBlock>

      <MapConnector variant="accent" label="+ adds" />

      <MapBlock
        variant="plus"
        id="intelligence"
        kicker="When real users arrive"
        name="CopilotKit Intelligence"
        description="The platform your runtime talks to. Remembers, learns, and shows you what happened — without changing your frontend or your agent framework."
        badge="Free to start · cloud or self-hosted"
        action={{
          label: "Connect in 5 minutes",
          href: "/intelligence/quickstart",
        }}
      >
        {/* Rendered directly here, not through `ScopedCapabilities`:
         * Intelligence pages are platform pages with one canonical
         * location and are never framework-scoped, so these hrefs need
         * no client-side prefixing. */}
        <div className={MAP_TILE_GRID_CLASS}>
          {INTELLIGENCE_CAPABILITIES.map((capability) => (
            <CapabilityTile
              key={capability.href}
              capability={capability}
              href={capability.href}
              tone="plus"
            />
          ))}
        </div>
      </MapBlock>

      <MapConnector variant="plain" label="AG-UI" />

      <MapBlock
        variant="choice"
        nameSize="sm"
        id={DOCS_MAP_FRAMEWORKS_ANCHOR}
        kicker="Bring your own · your choice"
        name="Agent"
        description="Any framework that speaks AG-UI, or CopilotKit's own built-in agent."
      >
        <PickGrid picks={agentPicks()} />
      </MapBlock>
    </>
  );
}
