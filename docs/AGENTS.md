# Docs Folder Instructions

Read [README.md](README.md) before editing anything in this folder.

The top-level `docs/` app is retired and does not publish to
docs.copilotkit.ai. Do not author CopilotKit docs in `docs/content/docs/`, and
do not rely on `showcase/scripts/sync-docs-from-main.ts` as a publishing path.

Author live CopilotKit docs in `showcase/shell-docs/src/content/` instead:

- Guides and concepts: `showcase/shell-docs/src/content/docs/`
- API reference: `showcase/shell-docs/src/content/reference/`
- Reusable snippets: `showcase/shell-docs/src/content/snippets/`
- Framework overview pages: `showcase/shell-docs/src/content/framework-overviews/`

Shell-docs is partly authored MDX and partly generated from `showcase/`.
Pages can pull runnable demos and snippets from generated showcase bundles such
as `showcase/shell-docs/src/data/demo-content.json`,
`showcase/shell-docs/src/data/catalog.json`, and
`showcase/shell-docs/src/data/registry.json`. When a docs page uses
`<Snippet>`, `<InlineDemo>`, or framework-specific variants, check the
corresponding showcase demo or integration manifest before assuming the MDX
alone owns the content.

If a requested change appears to live under `docs/content/docs/`, find the
canonical shell-docs counterpart and edit that file. Treat this folder as
read-only history unless the task is specifically about maintaining the retired
app or documenting the retirement.
