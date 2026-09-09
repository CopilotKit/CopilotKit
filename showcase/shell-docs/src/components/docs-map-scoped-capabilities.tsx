"use client";

// ScopedCapabilities — the six CopilotKit capability tiles on the docs
// homepage product map, scoped to the framework the reader last chose.
//
// `src/lib/registry.ts` warns client components off importing it: it drags
// in `src/data/registry.json`, roughly 646 KB. The map's four blocks are
// otherwise server-rendered; this is the only piece that needs a hook
// (`useFramework`) to read the remembered framework, so it is the map's
// single client boundary. `frameworks` is the server-supplied replacement
// for `getIntegration()` — a slug→{hrefPrefix} record — so this module can
// resolve the href prefix without importing any registry code.
// `MapCapability` is imported with `import type` only: a runtime import of
// `@/lib/homepage-map` would pull `@/lib/registry` in behind it and defeat
// the whole split.

import React from "react";
import { useFramework } from "./framework-provider";
import { CapabilityTile, MAP_TILE_GRID_CLASS } from "./docs-map-parts";
import type { MapCapability } from "@/lib/homepage-map";

export function ScopedCapabilities({
  capabilities,
  frameworks,
}: {
  capabilities: readonly MapCapability[];
  frameworks: Readonly<Record<string, { hrefPrefix: string }>>;
}): React.JSX.Element {
  const { framework, storedFramework, effectiveFramework } = useFramework();

  // Scope resolution, URL → remembered → default.
  //
  // `storedFramework` is null during SSR and during the first client
  // render (the provider reads localStorage in an effect), so hydration
  // matches the server markup character for character; the remembered
  // framework is layered on afterwards. Same shape as
  // `StoredFrameworkHighlight` and the v1 `DocsBuildWith` this replaces.
  //
  // `storedFramework` is advisory and unvalidated on read (an older build,
  // or a hand-edited localStorage, could hold a slug this docs site no
  // longer serves), so it only counts when it is a key in `frameworks` —
  // otherwise the tiles would point at pages that 404.
  const remembered =
    storedFramework && Object.hasOwn(frameworks, storedFramework)
      ? storedFramework
      : null;
  const scope = framework ?? remembered ?? effectiveFramework;
  // The `{ hrefPrefix: "" }` fallback is defensive only: from
  // `DocsProductMap`'s own composition, `scope` is always a key in
  // `frameworks` (either the URL framework, always null on `/`, or
  // `effectiveFramework` — always `ROOT_FRAMEWORK`, which the filtered
  // record always contains), so this branch is unreachable there. It stays
  // because this component takes `frameworks` as a prop and must not crash
  // for a caller that passes a narrower record. `Object.hasOwn` rather than
  // `in`: a record built with `Object.fromEntries` answers bare `in` for
  // inherited `Object.prototype` members, so a stored "constructor" would
  // read `Object.hrefPrefix` — undefined — and prefix every tile with the
  // literal string "undefined".
  const { hrefPrefix } = Object.hasOwn(frameworks, scope)
    ? frameworks[scope]
    : { hrefPrefix: "" };

  return (
    <div className={MAP_TILE_GRID_CLASS}>
      {capabilities.map((capability) => (
        <CapabilityTile
          key={capability.href}
          capability={capability}
          href={
            capability.href.startsWith("/")
              ? `${hrefPrefix}${capability.href}`
              : capability.href
          }
          tone="core"
        />
      ))}
    </div>
  );
}
