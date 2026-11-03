# Shell Docs

`showcase/shell-docs` serves the CopilotKit docs at `docs.copilotkit.ai`. It is
built on the latest [Fumadocs](https://fumadocs.dev) (Next.js +
`fumadocs-mdx`), as a standalone npm app outside the pnpm workspace.

Design work starts from [`PRODUCT.md`](./PRODUCT.md) (who the docs serve, the
binding brand source) and [`DESIGN.md`](./DESIGN.md) (the theme and how it maps
onto Fumadocs). Theming stays inside Fumadocs' supported surface.

## Run locally

```bash
cd showcase/shell-docs
npm install
npm run dev
```

The dev server runs on http://localhost:3003. The docs live at their
docs.copilotkit.ai URLs (`/quickstart`, `/mastra/frontend-tools`,
`/reference/v2/...`).

"Ask AI" needs an OpenAI key: copy `.env.example` to `.env.local` and set
`OPENAI_API_KEY`.

## Content

The docs pages live in `src/content`. Components resolve by name, so a page
imports only `.mdx` snippets, and a page with sub-pages is `X/index.mdx`.
Images, logos and videos are in `public/`: only icons, plus the images a page
shows, which go through Git LFS.

```bash
npm run check-live-mdx     # compile every page offline
npm run check-live-pages   # request every page at its live URL (dev server up)
npm run check-redirects    # legacy docs.copilotkit.ai redirects
```

## Docker

The [`Dockerfile`](./Dockerfile) builds from the repo root, because
showcase-data reads the sibling `showcase/` folders. A checkout without Git LFS
has pointer files for the images in `public/`, so the Dockerfile runs
`scripts/fetch-lfs.mjs` to download them.

```bash
docker build -f showcase/shell-docs/Dockerfile -t shell-docs .
docker run --rm -p 3000:3000 -e OPENAI_API_KEY shell-docs
```

## Validate

```bash
npm run build
npm run typecheck
npm run lint
```

## Layout

| Path                                            | Purpose                                                     |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `src/content`                                   | The docs pages                                              |
| `src/lib/live-source.ts`                        | Live docs and reference collections                         |
| `src/lib/live-docs.ts`                          | Live URL to page, with its framework and frontend scope     |
| `src/lib/live-nav.ts`                           | Live sidebars from shell-docs' `meta.json` files            |
| `src/proto/live-article.tsx`                    | Renders a live page in D's docs panel                       |
| `src/components/docs-mdx`                       | shell-docs' MDX components, by name                         |
| `src/components/standard-catalog`               | Standard catalog pages: a Fumadocs Story per component      |
| `src/lib/catalog-nav.ts`                        | The sidebar's Standard catalog folder, a page per component |
| `src/components/telemetry`, `src/lib/telemetry` | shell-docs' analytics, same events and env vars             |
| `src/lib/redirects`                             | shell-docs' legacy URL redirects                            |
| `source.config.ts`                              | MDX options for every page and snippet                      |
| `src/lib/shared.ts`                             | App name, routes, GitHub config                             |
| `src/app/theme.css`                             | CopilotKit theme over Fumadocs' variables (see `DESIGN.md`) |
| `src/app/api/search`                            | Built-in Orama search endpoint                              |
| `src/app/og`                                    | Generated OG images per page                                |
| `src/app/llms*.txt`, `llms.mdx`                 | LLM-readable text and per-page markdown                     |
| `src/proxy.ts`                                  | Serves markdown for `*.md` URLs and `Accept: text/markdown` |
| `src/app/api/mcp`                               | MCP server (list, read, search pages) for outside agents    |
| `src/app/api/copilotkit`                        | "Ask AI" runtime: per-IP rate limit and request caps        |
| `src/lib/docs-agent.ts`                         | "Ask AI" agent: model, scope prompt, tools, hosted MCP      |
| `src/components/ai`                             | "Ask AI" chat in Spacious' `aiChat` slot, frontend tools    |

Scaffolded with `create-fumadocs-app@16.2.26` (`+next+fuma-docs-mdx`, `--src`,
oxlint, Orama search, `next-og`).
