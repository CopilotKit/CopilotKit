# Hook Development

When creating a new hook, always complete **all** of the following:

1. **Implementation**: Create the hook in `@copilotkit/react-core`. If backward compatibility shims are needed, add them in the package's `v1/` directory.
2. **JSDoc**: Add JSDoc on top of the hook implementation, including usage examples.
3. **Tests**: Write extensive tests covering behavior, edge cases, and lifecycle (mount/unmount/re-render).
4. **API reference**: Add a reference page at `showcase/shell-docs/src/content/reference/hooks/<hookName>.mdx` with `title` and `description` frontmatter. The v2 reference navigation is generated automatically by walking the `reference/` tree and reading frontmatter (see `showcase/shell-docs/src/lib/reference-items.ts`) — there is **no `meta.json`** to edit for v2 reference; the file and its frontmatter are the metadata. (Only the legacy `reference/v1/` tree uses `meta.json`.)
5. **Conceptual docs (if needed)**: If the hook needs usage/how-to documentation beyond the API reference, add a guide page under `showcase/shell-docs/src/content/docs/` and update that section's `meta.json` so it appears in navigation.

Never recreate the retired `docs/content/docs/` tree. The top-level `docs/` path is only
a symlink to shell-docs. See [Documentation](documentation.md).
