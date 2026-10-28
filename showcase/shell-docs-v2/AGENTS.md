# Shell Docs v2: agent guidance

Read these before changing anything in this app:

- [`PRODUCT.md`](./PRODUCT.md): who the docs serve, scope, brand source, and constraints.
- [`DESIGN.md`](./DESIGN.md): the theme and how it maps onto Fumadocs. The theme itself lives in
  [`src/app/theme.css`](./src/app/theme.css); `/docs/theme` renders every element for checking it.

Stay on stock Fumadocs. Brand it only through Fumadocs' supported theming surface
(its CSS variables, presets, layout options, and component props). Don't fork,
replace, or restyle Fumadocs components from the outside. The theme rides on
Fumadocs' shadcn bridge preset, so colors are shadcn variables in `theme.css`.

For any component Fumadocs doesn't ship, use shadcn/ui (`components.json`,
`src/components/ui`); add it with `npx shadcn@latest add <name>` instead of
hand-building it.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
