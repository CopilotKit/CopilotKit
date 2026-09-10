# Supplemental reachable feature-guide audit

This closes the gap between the catalog-derived route matrix and actual root
MDX pages. Baseline: `fa6041fc7b08fc5866099769038e43c44c1ce8df`.

## Scope result

Scanning all `InlineDemo` references in `src/content/docs/` found 37
occurrences for 29 registered feature IDs. Exactly two IDs lack the
feature registry's `shell_docs_path`; there are no unregistered IDs and no
other catalog-missing feature-guide sources.

| Guide                                                                                          | Feature ID                | Bare route                   | Earlier audit state                                    | Supplement state                     |
| ---------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------- | ------------------------------------------------------ | ------------------------------------ |
| [BYOC — Hashbrown](../../showcase/shell-docs/src/content/docs/generative-ui/hashbrown.mdx)     | `declarative-hashbrown`   | `/generative-ui/hashbrown`   | omitted from 81 source units and 1,636 rendered routes | source-reviewed and locally rendered |
| [BYOC — JSON Render](../../showcase/shell-docs/src/content/docs/generative-ui/json-render.mdx) | `declarative-json-render` | `/generative-ui/json-render` | omitted from 81 source units and 1,636 rendered routes | source-reviewed and locally rendered |

The two entries are the confirmed mapping defect `CONTENT-GEN-004`:
[feature-registry.json](../../showcase/shared/feature-registry.json) registers
the IDs without `shell_docs_path`, while each MDX frontmatter declares the
matching `snippet_cell` and `InlineDemo`.

They are crawler-reachable even though neither is a Generative UI sidebar
entry. `getBareDocsPages()` includes every root docs MDX other than frontend
and integration overrides, and the sitemap expands non-global root docs under
every non-hidden non-root integration. This yields one bare route plus 17
framework-scoped routes for each guide, or 36 sitemap routes. The local
generation route policy maps the corresponding non-React frontend variants to
the native A2UI guide; that does not create native Hashbrown or JSON Render
support.

The source files cross-link to each other, but
[generative-ui/meta.json](../../showcase/shell-docs/src/content/docs/generative-ui/meta.json)
does not list either page. Thus `CONTENT-GEN-004` should describe them as
directly/sitemap reachable, rather than claim that they have sidebar entries.

## Local delivery validation

The disposable shell-docs app at `/private/tmp/copilotkit-shell-docs-render-audit`
was regenerated and started only for this probe. The durable
[probe script](probe_reachable_outlier_guides.py) requested all 36 sitemap
routes in HTML and `/llms-mdx` form. The
[results](reachable-outlier-route-probe.json) show 72/72 HTTP 200 responses,
no transport failures, both expected page titles, matching demo markers, and
no rendered `Missing snippet` marker. No iframe URL was requested.

This validates delivery only. It does not qualify a frontend or backend that
does not declare the feature as supported.

## Confirmed source-provenance defects

### Proposed CONTENT-GEN-037 — Hashbrown copied API drift

The guide's code describes `useJsonParser(message.content)` and
`useUiKit({ catalog, value })`, but the installed `@hashbrownai/react`
`0.5.0-beta.4` declarations require a parser schema and a UI kit made from
`components` (with optional `examples`), then rendered through the kit. The
identical selected Showcase renderers use that contract. This is a copied code
example that does not represent the maintained runnable source.

Evidence: [guide](../../showcase/shell-docs/src/content/docs/generative-ui/hashbrown.mdx),
[selected renderer setup](../../showcase/integrations/langgraph-python/src/app/demos/declarative-hashbrown/hashbrown-renderer.tsx),
[selected renderer consumption](../../showcase/integrations/langgraph-python/src/app/demos/declarative-hashbrown/hashbrown-renderer.tsx),
and installed type declarations at
`showcase/integrations/langgraph-python/node_modules/@hashbrownai/react/src/hooks/{use-ui-kit,use-json-parser}.d.ts`.

### Proposed CONTENT-GEN-038 — JSON Render source drift

The guide shows a plain component/`propsSchema` catalog and calls parser
helpers that it does not define. The repository-owned selected implementation
instead uses `defineCatalog`, `defineRegistry`, `JSONUIProvider`, and an
explicit `root`/`elements` validator. The guide is readable prose, but it is
not an exact runnable source reference.

Evidence: [guide](../../showcase/shell-docs/src/content/docs/generative-ui/json-render.mdx),
[selected renderer](../../showcase/integrations/langgraph-python/src/app/demos/declarative-json-render/json-render-renderer.tsx),
[registry](../../showcase/integrations/langgraph-python/src/app/demos/declarative-json-render/registry.tsx),
and [catalog](../../showcase/integrations/langgraph-python/src/app/demos/declarative-json-render/catalog.ts).

`CONTENT-GEN-037` and `CONTENT-GEN-038` are separate from `CONTENT-GEN-004`:
the latter is the catalog binding/discovery fault, while these are source
accuracy faults in the two existing guide bodies.
