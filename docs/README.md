# ⛔ This docs app is retired — do not edit files here

**CopilotKit documentation is now authored in [`showcase/shell-docs/`](../showcase/shell-docs/).**

This top-level `docs/` Next app and its `content/docs/` MDX tree no longer publish to the
live site. Changes made here will **not** reach docs.copilotkit.ai. The
`showcase/scripts/sync-docs-from-main.ts` script is legacy (one-direction, `docs/` → shell-docs)
and should not be relied on.

Agents should also read [AGENTS.md](AGENTS.md). It exists to prevent future
edits from landing in this retired tree when the live source is in
`showcase/shell-docs/src/content/`.

- **CopilotKit docs** → author in `showcase/shell-docs/src/content/`
  (`docs/`, `reference/`, `snippets/`, `framework-overviews/`).
- **Showcase-backed docs content** → many shell-docs pages embed generated
  showcase snippets/demos through `<Snippet>` and `<InlineDemo>`. If the text
  or code appears to come from a runnable demo, inspect the matching
  `showcase/` integration/demo source and generated shell-docs data as well as
  the MDX page. For docs pages with an integration grid, keep the showcase
  feature registry, manifests, and D5/D6 probes/fixtures aligned with the
  reader-visible examples.
- **AG-UI protocol docs** → author upstream in
  [`ag-ui-protocol/ag-ui`](https://github.com/ag-ui-protocol/ag-ui) (publishes to docs.ag-ui.com),
  then sync back into the mirror at `showcase/shell-docs/src/content/ag-ui/`.

See [.claude/docs/documentation.md](../.claude/docs/documentation.md) for the full rule.

---

<details>
<summary>Legacy README (retained for history)</summary>

This is a Next.js application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
npm run dev
# or
pnpm dev
# or
yarn dev
```

Open http://localhost:3000 with your browser to see the result.

## Learn More

To learn more about Next.js and Fumadocs, take a look at the following
resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js
  features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.
- [Fumadocs](https://fumadocs.vercel.app) - learn about Fumadocs

## Vercel Deployment with Git LFS

Docs assets are tracked with Git LFS. To ensure production builds always receive
real asset bytes (not pointer files), deploy docs through GitHub Actions using
`.github/workflows/deploy_docs_vercel.yml`.

Required GitHub repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID_DOCS`

PR previews:

- `.github/workflows/deploy_docs_vercel_preview.yml` deploys docs previews for
  non-fork pull requests.
- The workflow posts/updates a sticky PR comment with a clickable
  `Open Docs Preview` link.

Recommended Vercel project setting:

- Disable automatic Git-based deployments for the docs project and let the
  GitHub Actions workflow handle production deploys.

</details>
