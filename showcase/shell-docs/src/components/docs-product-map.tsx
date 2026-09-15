// DocsProductMap — the server-rendered shell of the docs homepage product
// map. Composes the intro, the four blocks (Frontend, CopilotKit,
// Intelligence, Agent) and the three connectors from `./docs-map-parts` and
// `@/lib/homepage-map`.
//
// The arrangement is not a stack. A stack reads Frontend → CopilotKit →
// Intelligence → Agent, which says the agent talks to Intelligence; it does
// not. The agent talks to the runtime over AG-UI, and Intelligence attaches
// to that runtime as a side branch, so Intelligence is inset to the right,
// the `+ adds` branch drops into it from CopilotKit, and the AG-UI axis
// runs down the left, past Intelligence, to the Agent block. The grid that
// does this lives in `./docs-map-parts`; see that file's header for the row
// map.
//
// This must stay a plain, synchronous server component with no `"use client"`
// directive and no hook: it calls `visibleIntegrations()`/`agentPicks()` from
// `@/lib/homepage-map`, which pull in `getIntegrations` from `@/lib/registry`
// and, behind that, `src/data/registry.json` (~646 KB, see registry.ts lines
// 137-146) — a cost client bundles must never pay. The only piece of this
// page that needs a hook is the six CopilotKit tiles scoped to the reader's
// remembered framework, and that already lives in the client leaf
// `./docs-map-scoped-capabilities`, composed here as a child. Same split as
// `stored-framework-highlight.tsx`: the server renders the shell, a small
// client component layers the remembered value on top.

import React from "react";

import {
  CapabilityTile,
  MAP_GRID_CLASS,
  MAP_TILE_GRID_CLASS,
  MapAxis,
  MapBlock,
  MapBranch,
  MapConnector,
  MapGap,
  MapIntro,
  PickGrid,
} from "./docs-map-parts";
import { ScopedCapabilities } from "./docs-map-scoped-capabilities";
import { IntelligenceKiteIcon } from "./intelligence-kite-icon";
import {
  COPILOTKIT_CAPABILITIES,
  INTELLIGENCE_CAPABILITIES,
  agentPicks,
  frontendPicks,
  scopedHref,
  visibleIntegrations,
} from "@/lib/homepage-map";

/**
 * Anchor id for the Agent block. Exported from here (rather than from
 * `docs-map-parts` or `homepage-map`) because the route imports
 * `DocsProductMap` from this file and has no other reason to reach into the
 * map's internals.
 */
export const DOCS_MAP_FRAMEWORKS_ANCHOR = "frameworks";

export function DocsProductMap(): React.JSX.Element {
  // The validation set for a remembered framework slug. Built from every
  // known integration, the same reach the old `getIntegration(slug)` lookup
  // had — except for one deliberate narrowing beyond both v1 and the
  // written spec: `docs_mode: "hidden"` slugs are dropped. `knownFrameworks`
  // in `src/app/layout.tsx` is filtered only by reserved route slugs, so a
  // hidden integration's slug is still in it — visiting `/spring-ai/...`
  // renders the layout and persists `"spring-ai"` to localStorage through
  // the framework provider's remembered-slug effect *before* the route's
  // own `notFound()` fires. Without this filter, the next visit to `/`
  // would find that stored slug still a key here, scope the whole map to
  // it, and point all six tiles at pages that 404. Filtering it out makes
  // `remembered` resolve to null instead,
  // falling back to `effectiveFramework` — the same rescue `agentPicks()`
  // already performs in `homepage-map.ts`. `scopedHref("", slug)` yields
  // exactly that framework's href prefix (`""` for the root framework,
  // `/<slug>` otherwise). The visibility rule itself (`docs_mode !==
  // "hidden"`) is owned by `visibleIntegrations()` in `homepage-map.ts`
  // alone — this and every other homepage call site delegate to it rather
  // than re-checking `docs_mode` locally.
  const frameworks = Object.fromEntries(
    visibleIntegrations().map((integration) => [
      integration.slug,
      { hrefPrefix: scopedHref("", integration.slug) },
    ]),
  );

  return (
    <div className={MAP_GRID_CLASS}>
      <MapIntro
        heading="How CopilotKit fits together"
        body="Your frontend and your agent are yours to choose. CopilotKit sits between them: the SDK in your app, the runtime on your server. CopilotKit Intelligence attaches to that runtime when you take it to production."
      />

      <MapBlock
        variant="choice"
        nameSize="sm"
        name="Frontend"
        description="CopilotKit ships the same primitives for every one of these. Pick the one you already use. Nothing else on this page changes."
      >
        <PickGrid picks={frontendPicks()} />
      </MapBlock>

      <MapConnector />

      <MapBlock
        variant="core"
        name="CopilotKit"
        description="The SDK in your app and the runtime on your server. Everything your users actually touch, running entirely on your side."
        // Deliberately unscoped: the spec scopes only the six capability
        // tiles below, and this block header is server-rendered with no
        // access to the reader's remembered framework.
        action={{ label: "Quickstart", href: "/quickstart" }}
      >
        <ScopedCapabilities
          capabilities={COPILOTKIT_CAPABILITIES}
          frameworks={frameworks}
        />
      </MapBlock>

      <MapBranch label="+ adds" />

      <MapBlock
        variant="plus"
        placement="inset"
        id="intelligence"
        name="CopilotKit Intelligence"
        icon={<IntelligenceKiteIcon />}
        description="The platform your runtime talks to. Remembers, learns, and shows you what happened, without changing your frontend or your agent framework."
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

      <MapAxis label="AG-UI" href="/ag-ui/agentic-protocols" />

      <MapGap />

      <MapBlock
        variant="choice"
        nameSize="sm"
        id={DOCS_MAP_FRAMEWORKS_ANCHOR}
        name="Agent"
        description="Any framework that speaks AG-UI, or CopilotKit's own built-in agent."
      >
        <PickGrid picks={agentPicks()} />
      </MapBlock>
    </div>
  );
}
