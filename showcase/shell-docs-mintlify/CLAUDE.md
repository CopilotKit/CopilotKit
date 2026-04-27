# shell-docs-mintlify

Mintlify Astro starter rebuilt with a config-driven IA. **One canonical doc per
topic, aliased to all integrations.** Single source of truth in
[`integrations.config.ts`](integrations.config.ts); everything else is
generated.

## Quickstart

```bash
# Dev preview (predev hook auto-runs the generator)
npm run dev                     # → http://localhost:4321
# or, via Claude Preview
mcp__Claude_Preview__preview_start { name: "shell-docs-mintlify" }

# Regenerate aliases / docs.json / integrations.css after config edits
npm run gen

# Build (prebuild hook auto-runs the generator)
npm run build

# Tests (Vitest)
npm test
```

The Claude Preview launch config is wired in [`../.claude/launch.json`](../.claude/launch.json).

## Information architecture

**URL = integration.** No state, no banners.

- `/quickstart` → built-in (canonical/default)
- `/langgraph/quickstart` → LangGraph variant
- `/langgraph/subgraphs` → LangGraph-only page

The pill in the sidebar reflects the URL — clicking it navigates to the
corresponding URL on the chosen track. There is no client-side state to flip.

**Three page types:**

| Type                  | Where                                                  | Aliased?                                                |
| --------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| Universal page        | `docs/<slug>.mdx` (canonical)                          | Yes — to every non-default integration                  |
| Variant page          | One canonical with `<Variant for="...">` blocks inside | Yes — content swaps via CSS on `body[data-integration]` |
| Integration-only page | `docs/<integration>/<slug>.mdx` (one file)             | No — only appears in that integration's nav             |

## Source of truth

[`integrations.config.ts`](integrations.config.ts) is the entire IA in one
file:

```ts
integrations: [
  { slug: 'built-in', label: 'CopilotKit (Default)', color: '#16A34A', showcaseSlug: 'built-in-agent' },
  { slug: 'langgraph', label: 'LangGraph', color: '#7C3AED', showcaseSlug: 'langgraph-typescript' },
  // ...
]
defaultIntegration: 'built-in'
universalPages: [{ slug, title, description, group }, ...]
integrationOnlyPages: { langgraph: [{ slug, title }, ...], ... }
```

Edit this file to add an integration, add a universal page, or move pages
between sidebar groups. Then `npm run gen` (or just `npm run dev` — `predev`
runs the generator).

## Generated files (DO NOT EDIT)

The generator emits files with an `# AUTO-GENERATED` marker in their
frontmatter. The orphan-cleanup logic only deletes files carrying that marker
— it leaves author content intact.

| File                                          | Generator                             | Purpose                                                                          |
| --------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| `docs/<integration>/<slug>.mdx` (alias stubs) | `scripts/generate-routing.ts`         | Re-render canonical content at the prefixed URL                                  |
| `docs/docs.json`                              | `scripts/generate-routing.ts`         | Mintlify nav structure (groups + pages)                                          |
| `src/styles/integrations.css`                 | `scripts/generate-routing.ts`         | Per-integration visibility rules (variant blocks, sidebar groups, sidebar items) |
| `src/lib/showcase.config.json`                | `scripts/generate-showcase-config.ts` | Maps integration slug → deployed showcase URL + available demos                  |

Both generators run via `npm run gen` (and automatically on `predev` / `prebuild`).

## Authoring patterns

### Add a universal page (concept that applies to every integration)

1. Append to `universalPages` in `integrations.config.ts`:
   ```ts
   {
     slug: 'my-page',
     title: 'My page',
     description: '...',
     group: 'Core features', // existing groups: Get started · Core features · Generative UI · UI customization · Under the hood · Troubleshooting · Reference · Ecosystem
   }
   ```
2. Author the canonical content at `docs/my-page.mdx` (with frontmatter `title`, `description`, `icon: "lucide/<Name>"`).
3. `npm run gen` — generates `docs/<integration>/my-page.mdx` aliases for every non-default integration.

Nested slugs work: `slug: 'generative-ui/tool-rendering'` writes to `docs/generative-ui/tool-rendering.mdx` and aliases at `docs/<integration>/generative-ui/tool-rendering.mdx`.

### Add per-integration code/setup variation in a universal page

Use `<Variant for="<slug>">...</Variant>` blocks inline:

```mdx
## Install

<Variant for="built-in">
  \`\`\`bash npm install @copilotkit/runtime \`\`\`
</Variant>

<Variant for="langgraph">
  \`\`\`bash npm install @copilotkit/runtime @langchain/langgraph \`\`\`
</Variant>
```

CSS on `body[data-integration]` shows only the matching block. Hidden blocks
are `display: none` (browsers don't fetch hidden iframe content either).

### Add an integration-only page (concept that only applies to one integration)

1. Add the entry to `integrationOnlyPages` in `integrations.config.ts`:
   ```ts
   integrationOnlyPages = {
     langgraph: [{ slug: 'subgraphs', title: 'Subgraphs' }, ...],
   }
   ```
2. Author content at `docs/<integration>/<slug>.mdx`.
3. `npm run gen` — populates the appropriate `[<integration>] <Label> features` sidebar group.

### Override a universal page for one integration

When a universal concept needs a fundamentally different page for one integration (e.g. LangGraph's `shared-state` uses LangGraph's state graph, not the AG-UI state tools the canonical page describes):

1. Author content at `docs/<integration>/<slug>.mdx` — same path the alias generator would use.
2. Don't include the `# AUTO-GENERATED by scripts/generate-routing.ts` marker. The generator detects authored content and skips the alias write.
3. Re-run `npm run gen` — output reports `Skipped N alias write(s) (authored override exists)`.

The page keeps its position in the original universal sidebar group (since the slug is still in `universalPages`). Don't add the slug to `integrationOnlyPages` — that would create a duplicate entry under the integration-features group.

Use overrides sparingly: most differences are better expressed with `<Variant for="...">` blocks inside the canonical. Reach for an override only when the page would diverge so heavily that variants would dominate the file.

### Embed a live showcase demo

```mdx
<ShowcaseDemo feature="tool-rendering" title="Live demo" />
```

The component renders one iframe per integration (CSS shows the matching one).
URL = `${backendUrl}/demos/${feature}` from `showcase.config.json`. Available
features are auto-discovered from `showcase/packages/<slug>/src/app/demos/`.

If the current integration has no deployed showcase, a graceful "Live demo not
yet available" fallback renders.

### Add a new integration

1. Append to `integrations` in `integrations.config.ts`:
   ```ts
   { slug: 'new-thing', label: 'New Thing', color: '#XXXXXX', showcaseSlug: 'new-thing' }
   ```
   (Drop `showcaseSlug` if no showcase exists — the pill still works, demos will fall back.)
2. `npm run gen` — generates 30+ alias files + adds to all sidebar groups + adds CSS visibility rules.
3. (Optional) Add `<Variant for="new-thing">` blocks to `quickstart.mdx` for setup instructions.
4. (Optional) Add integration-only pages under `integrationOnlyPages`.

## Conventions

- **v2 only.** Never document v1. APIs come from `@copilotkit/react-core/v2`, `@copilotkit/runtime/v2`. The v1 service adapters (`AnthropicAdapter`, etc.) and v1 hooks (`useCopilotAction`, `useCopilotReadable`) are deprecated and out of scope.
- **Model strings:** `gpt-5.4-mini`, `gpt-5.4`, etc. ARE real per-product. **Never auto-correct** to `gpt-4o` or `gpt-4.1` even if they look like typos.
- **Slugs** are kebab-case (`use-agent`, `tool-rendering`). Page TITLES (frontmatter) can be camelCase for hooks (`useAgent`).
- **Frontmatter `icon:`** must be a Lucide name with `lucide/` prefix: `icon: "lucide/Wrench"`.
- **Component aliases:** Mintlify provides `<Note>`, `<Tip>`, `<Info>`, `<Warning>`, `<Card>`, `<Cards>`, `<Columns>`, `<Tabs>`/`<Tab>`, `<Steps>`/`<Step>`, `<AccordionGroup>`/`<Accordion>`. Do NOT use `<Cards>` (use `<Columns cols={N}>`); do NOT use `<Accordions>` (use `<AccordionGroup>`).
- **Custom MDX components** are registered globally in [`src/pages/[...slug].astro`](src/pages/[...slug].astro): `<Variant>`, `<ShowcaseDemo>`. Use them directly in MDX without imports.

## Reference docs

Live under `docs/reference/`:

- `reference/hooks/<name>.mdx` — React hooks (use-agent, use-frontend-tool, ...)
- `reference/components/<name>.mdx` — React components (copilot-kit-provider, copilot-chat, ...)
- `reference/runtime/<name>.mdx` — Runtime classes/functions
- `reference/agents/<name>.mdx` — Agent classes (built-in-agent, http-agent)
- `reference/handlers/<name>.mdx` — Endpoint handlers (Hono, Express)
- `reference/middleware/<name>.mdx` — Middleware (before/after request, A2UI, MCP apps, ...)

Reference URL slugs are kebab-case; titles are the actual export names.

## Sidebar groups (current order)

1. Get started
2. Core features
3. Generative UI
4. UI customization
5. Under the hood
6. Reference
7. Ecosystem
8. Troubleshooting
9. `[<integration>] <Label> features` (one per integration with integration-only pages)

Group order follows first occurrence in `universalPages`. Integration-only
groups are appended in integration declaration order.

## Things to avoid

- **Editing generated files** (`docs/<integration>/<universal-slug>.mdx` aliases, `docs/docs.json`, `src/styles/integrations.css`, `src/lib/showcase.config.json`) — they get overwritten on next `npm run gen`. Edit the source instead.
- **Hand-writing nav in `docs.json`** — the generator owns this file.
- **Adding alias files manually** — `npm run gen` handles this.
- **Documenting v1 features** — out of scope.
- **Touching model strings** — `gpt-5.4-mini` is correct as-is.
- **Mass-edits across `docs/<integration>/` directories** — those are aliases. Edit the canonical at `docs/<canonical-slug>.mdx`; the change propagates on next `gen`.

## Troubleshooting

- **"Could not resolve `../<slug>.mdx`" build error**: an alias file references a canonical that doesn't exist. Either add the canonical, or remove the entry from `universalPages` and re-run `npm run gen`.
- **Mintlify cache stale** (component refs that no longer exist): `rm -rf .mintlify .astro dist node_modules/.vite && npm run build`.
- **Sidebar shows wrong items per integration**: the CSS in `src/styles/integrations.css` is auto-generated. Check `body[data-integration]` is set on the `<body>` tag (it's set by [`Layout.astro`](src/layouts/Layout.astro) using `resolveIntegration(Astro.url.pathname)`).
- **`<Variant>` block always hidden**: check that the `for=` value matches a slug in `integrations` config. Unknown slugs are silently dropped.
- **Demo iframe shows fallback when it shouldn't**: confirm `showcaseSlug` in the integration config matches a directory under `showcase/packages/`, AND `showcase/packages/<slug>/manifest.yaml` has `deployed: true`, AND `src/app/demos/<feature>/` exists in that package.
