# Shell Docs v2

`showcase/shell-docs-v2` is a from-scratch rebuild of the CopilotKit docs on the
latest [Fumadocs](https://fumadocs.dev) (Next.js + `fumadocs-mdx`). It is a
work in progress and is not deployed; `showcase/shell-docs` still serves
`docs.copilotkit.ai`.

Like `shell-docs`, this is a standalone npm app outside the pnpm workspace.

Design work starts from [`PRODUCT.md`](./PRODUCT.md) (who the docs serve, the
binding brand source) and [`DESIGN.md`](./DESIGN.md) (the theme and how it maps
onto Fumadocs). Theming stays inside Fumadocs' supported surface.

## Run locally

```bash
cd showcase/shell-docs-v2
npm install
npm run dev
```

The dev server runs on http://localhost:3004. The docs live at their
docs.copilotkit.ai URLs (`/quickstart`, `/mastra/frontend-tools`,
`/reference/v2/...`); the older Fumadocs scaffold pages stay at `/docs`.

"Ask AI" needs an OpenAI key: copy `.env.example` to `.env.local` and set
`OPENAI_API_KEY`.

## Content

The docs content is ported from `showcase/shell-docs`, which still serves
production and stays the source of truth until the cut-over, so edit content
there. `npm run dev` and `npm run build` copy it into `content/live`
(gitignored); to refresh it while the dev server runs:

```bash
npm run sync-content   # shell-docs/src/content -> content/live, plus public assets
```

The copy is verbatim except that, like shell-docs, a page's imports are
dropped (components resolve by name) and only `.mdx` snippet imports stay.
`content/live` is never edited by hand.

```bash
npm run check-live-mdx     # compile every page offline
npm run check-live-pages   # request every page at its live URL (dev server up)
npm run check-redirects    # legacy docs.copilotkit.ai redirects
```

## Validate

```bash
npm run build
npm run typecheck
npm run lint
```

## Layout

| Path                                            | Purpose                                                        |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `content/live`                                  | The live docs, synced from shell-docs (`npm run sync-content`) |
| `src/lib/live-source.ts`                        | Live docs and reference collections                            |
| `src/lib/live-docs.ts`                          | Live URL to page, with its framework and frontend scope        |
| `src/lib/live-nav.ts`                           | Live sidebars from shell-docs' `meta.json` files               |
| `src/proto/live-article.tsx`                    | Renders a live page in D's docs panel                          |
| `src/components/docs-mdx`                       | shell-docs' MDX components, by name                            |
| `src/components/telemetry`, `src/lib/telemetry` | shell-docs' analytics, same events and env vars                |
| `src/lib/redirects`                             | shell-docs' legacy URL redirects                               |
| `source.config.ts`                              | MDX options for every page and snippet                         |
| `content/docs`                                  | Scaffold MDX pages at `/docs` and their `meta.json`            |
| `src/lib/source.ts`                             | Content source (`fumadocs-mdx/macro`) and loader               |
| `src/lib/shared.ts`                             | App name, routes, GitHub config                                |
| `src/app/theme.css`                             | CopilotKit theme over Fumadocs' variables (see `DESIGN.md`)    |
| `src/lib/layout.shared.tsx`                     | Shared nav options for the home and docs layouts               |
| `src/app/docs`                                  | Docs layout and page renderer                                  |
| `src/app/api/search`                            | Built-in Orama search endpoint                                 |
| `src/app/og`                                    | Generated OG images per page                                   |
| `src/app/llms*.txt`, `llms.mdx`                 | LLM-readable text and per-page markdown                        |
| `src/proxy.ts`                                  | Serves markdown for `*.md` URLs and `Accept: text/markdown`    |
| `src/app/api/mcp`                               | MCP server (list, read, search pages) for outside agents       |
| `src/app/api/copilotkit`                        | "Ask AI" runtime: per-IP rate limit and request caps           |
| `src/lib/docs-agent.ts`                         | "Ask AI" agent: model, scope prompt, tools, hosted MCP         |
| `src/components/ai`                             | "Ask AI" chat in Spacious' `aiChat` slot, frontend tools       |

Scaffolded with `create-fumadocs-app@16.2.26` (`+next+fuma-docs-mdx`, `--src`,
oxlint, Orama search, `next-og`).
