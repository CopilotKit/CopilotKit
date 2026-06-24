# Documentation — where to author it

There are **two** documentation domains. Putting a change in the wrong place means it
silently never reaches the live site. Read this before editing any docs.

## 1. CopilotKit product docs → `showcase/shell-docs/`

All CopilotKit documentation is authored in **`showcase/shell-docs/src/content/`**, which
builds and serves **docs.copilotkit.ai**:

| Content type                   | Location                                               |
| ------------------------------ | ------------------------------------------------------ |
| Guide / how-to / concept pages | `showcase/shell-docs/src/content/docs/`                |
| API reference                  | `showcase/shell-docs/src/content/reference/`           |
| Reusable snippets (shared MDX) | `showcase/shell-docs/src/content/snippets/`            |
| Framework overview pages       | `showcase/shell-docs/src/content/framework-overviews/` |

When you add a **guide page** under `showcase/shell-docs/src/content/docs/`, also update
that section's `meta.json` so it appears in navigation.

### Hybrid docs architecture

Framework docs are in a hybrid state while showcase coverage is being completed. The
framework's `docs_mode` controls how shell-docs resolves routes, sidebars, snippets, and
search content. The source of truth for showcase integrations is
`showcase/integrations/<slug>/manifest.yaml`; shell-docs reads the generated registry via
`showcase/shell-docs/src/lib/registry.ts`.

Use these human-facing terms when discussing modes:

| User-facing term | Code value             | Meaning                                                                                                                                          |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Showcase-driven  | `docs_mode: generated` | Framework overview, supported features, demos, source snippets, and search data come from showcase registry/generated data plus shared/root MDX. |
| Authored         | `docs_mode: authored`  | The framework has its own MDX tree under `showcase/shell-docs/src/content/docs/integrations/<docsFolder>/` and its own `meta.json` sidebar.      |
| Hidden           | `docs_mode: hidden`    | The framework is excluded from docs routes and framework switchers until it is ready to be shown.                                                |

Content resolution differs by mode:

- **Authored frameworks** load the framework-owned MDX tree first, then fall back to
  shared/root pages for intentionally shared content.
- **Showcase-driven frameworks (`docs_mode: generated`)** load shared/root MDX first and use
  sparse framework overrides only where a generated framework needs framework-specific copy.
- **Hidden frameworks (`docs_mode: hidden`)** should not receive user-facing docs edits until
  the framework is ready to become authored or showcase-driven.

Framework slugs do not always match docs folder names. Check `getDocsFolder()` in
`showcase/shell-docs/src/lib/registry.ts` before creating or moving framework-owned pages.

### How humans and agents should work

Before editing framework docs, check the framework's `docs_mode`.

- For **showcase-driven frameworks (`docs_mode: generated`)**, update the showcase inputs:
  integration manifests, demos, feature coverage, source regions, generated registry inputs,
  shared/root MDX, and sparse framework overrides. Do not edit generated files under
  `showcase/shell-docs/src/data/frameworks/` by hand.
- For **authored frameworks (`docs_mode: authored`)**, update the framework MDX tree under
  `showcase/shell-docs/src/content/docs/integrations/<docsFolder>/` and its `meta.json`.
- For **reference docs**, edit `showcase/shell-docs/src/content/reference/`. The v2
  reference navigation is generated from frontmatter, not `meta.json`.
- For **snippets**, edit `showcase/shell-docs/src/content/snippets/`; snippets feed both
  shared/root pages and framework-specific pages.
- To **flip a framework to showcase-driven docs**, complete showcase coverage first, then
  change `docs_mode`, regenerate shell-docs data, and verify routes, sidebar entries, search
  results, snippets, and framework switching.

**API reference is different.** The v2 reference (`reference/{components,hooks,sdk}/`) has
**no `meta.json`** — navigation is generated automatically by walking the tree and reading
each page's `title`/`description` frontmatter (see
`showcase/shell-docs/src/lib/reference-items.ts`). To add a reference page, drop an `.mdx`
file with frontmatter into the right subdirectory; it appears in nav on its own. Only the
legacy `reference/v1/` tree uses `meta.json`. For the full new-hook checklist see
[Hook Development](hooks.md).

**The top-level `docs/` path is only a symlink to `showcase/shell-docs/`.**
It exists for `cd docs` muscle memory, not as a separate docs app. The old
`docs/content/docs/` tree and retired Next app no longer publish anything. Historical
content remains recoverable from the archive refs: `archive/docs-save-do-not-prune` and
`archive/docs-retired-2026-06-17`.

## 2. AG-UI protocol docs → upstream `ag-ui-protocol/ag-ui`

The AG-UI protocol docs (the `showcase/shell-docs/src/content/ag-ui/` tree) are **not**
authored in this repo. Their canonical source is the upstream repo
**[`ag-ui-protocol/ag-ui`](https://github.com/ag-ui-protocol/ag-ui)** under its `docs/`
directory, which publishes to **docs.ag-ui.com**.

The `content/ag-ui/` copy here is a **downstream mirror** rendered on the CopilotKit docs
host. To change AG-UI protocol docs, make the change upstream in `ag-ui-protocol/ag-ui`;
it then needs to be synced back into the CopilotKit copy.

> **Do not author AG-UI content changes directly in `content/ag-ui/`** — they would diverge
> from upstream and never reach docs.ag-ui.com.

**Caveat (known, out of scope here):** there is currently no automated sync for the
`content/ag-ui/` mirror, so it can drift from upstream. Upstream is canonical — don't try to
change that process as part of unrelated work.

## Quick decision

- Changing a CopilotKit guide, reference, snippet, or framework page? → `showcase/shell-docs/src/content/`
- Changing AG-UI protocol docs? → upstream `ag-ui-protocol/ag-ui`, then sync
- Tempted to recreate `docs/content/docs/`? → stop, it's retired; use `showcase/shell-docs/`
