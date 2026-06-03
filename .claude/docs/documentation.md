# Documentation — where to author it

There are **two** documentation domains. Putting a change in the wrong place means it
silently never reaches the live site. Read this before editing any docs.

## 1. CopilotKit product docs → `showcase/shell-docs/`

All CopilotKit documentation is authored in **`showcase/shell-docs/src/content/`**, which
builds and serves **docs.copilotkit.ai**:

| Content type | Location |
| --- | --- |
| Guide / how-to / concept pages | `showcase/shell-docs/src/content/docs/` |
| API reference | `showcase/shell-docs/src/content/reference/` |
| Reusable snippets (shared MDX) | `showcase/shell-docs/src/content/snippets/` |
| Framework overview pages | `showcase/shell-docs/src/content/framework-overviews/` |

When you add a **guide page** under `docs/`, also update that section's `meta.json` so it
appears in navigation.

**API reference is different.** The v2 reference (`reference/{components,hooks,sdk}/`) has
**no `meta.json`** — navigation is generated automatically by walking the tree and reading
each page's `title`/`description` frontmatter (see
`showcase/shell-docs/src/lib/reference-items.ts`). To add a reference page, drop an `.mdx`
file with frontmatter into the right subdirectory; it appears in nav on its own. Only the
legacy `reference/v1/` tree uses `meta.json`. For the full new-hook checklist see
[Hook Development](hooks.md).

**The top-level `docs/` folder is retired. Never author there.**
`docs/content/docs/` and the `docs/` Next app no longer publish anything. The
`showcase/scripts/sync-docs-from-main.ts` script is legacy — it only ever copied
`docs/` → shell-docs in one direction, and editing `docs/` today does nothing for the
live site. Treat the whole top-level `docs/` tree as read-only history.

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
- Tempted to edit `docs/content/docs/`? → stop, it's retired; use `showcase/shell-docs/`
