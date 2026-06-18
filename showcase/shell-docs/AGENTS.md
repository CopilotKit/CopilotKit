# Shell Docs Instructions

Read [README.md](README.md) before editing anything in this folder.

`showcase/shell-docs` is the live CopilotKit docs app. The repository's
top-level `docs/` path is a symlink here for contributor muscle memory; do not
recreate the old `docs/content/docs/` tree.

Author live CopilotKit docs in `src/content/`:

- Guides and concepts: `src/content/docs/`
- API reference: `src/content/reference/`
- Reusable snippets: `src/content/snippets/`
- Framework overview pages: `src/content/framework-overviews/`

Shell-docs is partly authored MDX and partly generated from `showcase/`. Pages
can pull runnable demos and snippets from generated showcase bundles such as
`src/data/demo-content.json`, `src/data/catalog.json`, and
`src/data/registry.json`. When a docs page uses `<Snippet>`, `<InlineDemo>`, or
framework-specific variants, check the corresponding showcase demo or
integration manifest before assuming the MDX alone owns the content.

## Verifying Shell Docs Changes

When editing live docs, verify both the source files and the rendered routes.
Do not assume every docs page is generated from showcase, and do not assume
every framework URL uses the same MDX source.

1. Map the route to source:
   - Bare docs route: `src/content/docs/<route>.mdx`
   - Framework route: resolve the framework slug through `getDocsFolder()` and
     `getDocsMode()` in `src/lib/registry.ts`. `docs_mode: "authored"` pages
     load `src/content/docs/integrations/<folder>/<route>.mdx` first.
     Generated pages usually load the bare root MDX first and only use the
     integration file as a sparse fallback when no root page exists.
   - Shared snippets: `src/content/snippets/`
   Use `find src/content/docs -path '*<route>*' -print` and inspect the nearest
   `meta.json` files to understand sidebar structure.
2. Discover whether the page is showcase-derived. Search the target file and
   nearby shared snippets with:
   `rg -n "snippet_cell|<Snippet|<InlineDemo|@/snippets|<IntegrationGrid|<ToolRendering|<FrameworkSetup|<RunAndConnect"`.
   A `snippet_cell` frontmatter value supplies the default showcase cell for
   `<Snippet>` tags without an explicit `cell`; explicit `cell="..."` points
   directly at a showcase demo cell. For these pages, inspect the corresponding
   showcase demo/integration source and generated shell-docs data before
   changing code examples. Do not create docs-only showcase files or unused
   showcase components just to feed `<Snippet>`; if an example is conceptual
   and has no live demo behind it, author a normal MDX code fence instead.
   Some pages also render shared snippet components such as `<ToolRendering />`
   or imports from `@/snippets/...`; preserve those links when splitting or
   moving pages. Be careful with the docs inliner: snippet imports are often
   matched by exact JSX shapes such as
   `<SharedContent components={props.components} />`. Adding extra props can
   prevent the snippet from inlining and make the page silently lose content.
   If the page has an `<IntegrationGrid>` or the snippet points at a showcase
   cell, keep the showcase catalog complete as well: update the shared feature
   registry, every integration manifest that supports the feature, the D5
   mapping/script/fixture, and the D6 aimock fixtures. The D5/D6 checks should
   exercise the user-visible behavior described by the docs, not only prove that
   a route loads.
3. Preserve existing content where possible. Compare against git history with
   `git show <base>:<path>` and keep prior wording, snippet components,
   code-highlighting directives, and demo embeds unless the requested change
   clearly improves them.
4. For code highlighting, verify the highlighted lines match the intended code
   after rendering. Avoid off-by-one highlights that miss the relevant hook or
   include unrelated schema/import/brace lines. Check every changed snippet or
   code embed visually.
5. Enumerate variants before declaring coverage. For a route that appears under
   multiple frameworks, run
   `find src/content/docs -path '*/<route>.mdx' -print | sort` and check the
   corresponding `meta.json` files. If the sidebar or slug changed, also
   verify redirects.
6. Verify visually. Run the shell-docs dev server, open the affected bare route
   and representative framework routes in the browser, and capture screenshots
   or Playwright snapshots. For framework-selector-sensitive pages, verify at
   least the reference/bare page, the canonical LangGraph Python route, and one
   additional framework variant that uses a different MDX pattern if one exists.
   Inspect code blocks, not just headings: confirm expected Shiki syntax
   colors, highlighted lines from `[!code highlight]`, filenames, copy buttons,
   demos, and feature-viewer/code links survived the move.
7. Run source checks after visual verification. At minimum use
   `npm --prefix showcase/shell-docs run typecheck`; for routing/sidebar
   changes also run the relevant redirect tests and
   `npm --prefix showcase/shell-docs run build`. Check `git status` afterward
   so generated data churn is intentional.
