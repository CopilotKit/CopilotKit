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

## Verifying shell-docs changes

When editing live docs, verify both the source files and the rendered routes.
Do not assume every docs page is generated from showcase, and do not assume
every framework URL uses the same MDX source.

1. Map the route to source:
   - Bare docs route: `showcase/shell-docs/src/content/docs/<route>.mdx`
   - Framework route: resolve the framework slug through
     `getDocsFolder()` / `getDocsMode()` in
     `showcase/shell-docs/src/lib/registry.ts`.
     `docs_mode: "authored"` pages load
     `showcase/shell-docs/src/content/docs/integrations/<folder>/<route>.mdx`
     first. Generated pages usually load the bare root MDX first and only use
     the integration file as a sparse fallback when no root page exists.
   - Shared snippets: `showcase/shell-docs/src/content/snippets/`
   Use `find showcase/shell-docs/src/content/docs -path '*<route>*' -print`
   and inspect the nearest `meta.json` files to understand sidebar structure.
2. Discover whether the page is showcase-derived. Search the target file and
   nearby shared snippets with:
   `rg -n "snippet_cell|<Snippet|<InlineDemo|@/snippets|<IntegrationGrid|<ToolRendering|<FrameworkSetup|<RunAndConnect"`.
   A `snippet_cell` frontmatter value supplies the default showcase cell for
   `<Snippet>` tags without an explicit `cell`; explicit `cell="..."` points
   directly at a showcase demo cell. For these pages, inspect the corresponding
   showcase demo/integration source and generated shell-docs data before
   changing code examples.
   Some pages also render shared snippet components such as `<ToolRendering />`
   or imports from `@/snippets/...`; preserve those links when splitting or
   moving pages. Be careful with the docs inliner: snippet imports are often
   matched by exact JSX shapes such as `<SharedContent components={props.components} />`.
   Adding extra props can prevent the snippet from inlining and make the page
   silently lose content.
3. Preserve existing content where possible. Compare against git history with
   `git show <base>:<path>` and keep prior wording, snippet components,
   code-highlighting directives, and demo embeds unless the requested change
   clearly improves them.
4. Enumerate variants before declaring coverage. For a route that appears under
   multiple frameworks, run `find showcase/shell-docs/src/content/docs -path '*/<route>.mdx' -print | sort`
   and check the corresponding `meta.json` files. If the sidebar or slug
   changed, also verify redirects.
5. Verify visually. Run the shell-docs dev server, open the affected bare route
   and representative framework routes in the browser, and capture screenshots
   or Playwright snapshots. For framework-selector-sensitive pages, verify at
   least the reference/bare page, the canonical LangGraph Python route, and one
   additional framework variant that uses a different MDX pattern if one
   exists. Inspect code blocks, not just headings: confirm expected Shiki
   syntax colors, highlighted lines from `[!code highlight]`, filenames,
   copy buttons, demos, and feature-viewer/code links survived the move.
6. Run source checks after visual verification. At minimum use
   `npm --prefix showcase/shell-docs run typecheck`; for routing/sidebar
   changes also run the relevant redirect tests and
   `npm --prefix showcase/shell-docs run build`. Check `git status` afterward
   so generated data churn is intentional.

If a requested change appears to live under `docs/content/docs/`, find the
canonical shell-docs counterpart and edit that file. Treat this folder as
read-only history unless the task is specifically about maintaining the retired
app or documenting the retirement.
