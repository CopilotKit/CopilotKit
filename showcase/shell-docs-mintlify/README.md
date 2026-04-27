# Mintlify Astro Starter

Build a fully custom documentation frontend with [Astro](https://astro.build) while using Mintlify to manage your content, search, and AI infrastructure.

Instead of using Mintlify's hosted frontend, this starter lets you control the entire presentation layer — layouts, components, and styles — while the `@mintlify/astro` integration handles content processing, navigation resolution, and component rendering at build time.

For a detailed walkthrough, see the [Create a custom frontend](https://www.mintlify.com/docs/guides/custom-frontend) guide.

## Prerequisites

- [Node.js](https://nodejs.org) v20.17.0 or later (LTS recommended)
- A [Mintlify account](https://dashboard.mintlify.com)
- A [GitHub account](https://github.com)

## Getting started

### 1. Create your repository

Navigate to the [mintlify-astro-starter](https://github.com/mintlify/mintlify-astro-starter) repository on GitHub and click **Use this template** to create a new repository on your account. Then clone it locally:

```bash
git clone https://github.com/<your-username>/<your-repo>.git
cd <your-repo>
```

### 2. Connect to Mintlify

1. Sign up or log in at [dashboard.mintlify.com](https://dashboard.mintlify.com).
2. On the [Git settings](https://dashboard.mintlify.com/settings/deployment/git-settings) page, install the [Mintlify GitHub app](https://mintlify.com/docs/deploy/github).
3. Select your new repository, enable **Set up as monorepo**, and enter `/docs` as the docs directory path.
4. Click **Save changes**.

### 3. Configure environment variables

If you have a [Pro or Enterprise plan](https://mintlify.com/pricing), create a `.env` file at the project root to enable search and the AI assistant:

```bash
PUBLIC_MINTLIFY_SUBDOMAIN=your-subdomain
PUBLIC_MINTLIFY_ASSISTANT_KEY=your-assistant-api-key
```

**Subdomain** — the domain name portion of your dashboard URL. For example, if your URL is `https://dashboard.mintlify.com/org-name/domain-name`, your subdomain is `domain-name`.

**Assistant API key** — generate one on the [API keys](https://dashboard.mintlify.com/settings/organization/api-keys) page of your dashboard. It starts with `mint_dsc_`.

### 4. Install and run

```bash
npm install
npm run dev
```

Your site is now running at `http://localhost:4321`.

## Project structure

```
├── docs/                    # Documentation content
│   ├── docs.json            # Navigation and site configuration
│   ├── index.mdx            # Homepage
│   ├── quickstart.mdx
│   ├── customization.mdx
│   ├── components.mdx
│   └── guides/
│       └── example.mdx
├── src/
│   ├── pages/
│   │   └── [...slug].astro  # Catch-all route for MDX pages
│   ├── layouts/
│   │   └── Layout.astro     # Root HTML layout
│   ├── components/
│   │   ├── Header.astro     # Site header
│   │   ├── Footer.tsx       # Page footer
│   │   ├── SearchBar.tsx    # Search component
│   │   ├── Sidebar/         # Sidebar navigation
│   │   ├── Assistant/       # AI chat interface
│   │   └── TableOfContents.tsx
│   ├── hooks/               # Custom React hooks
│   ├── icons/               # SVG icon components
│   ├── styles/              # Global CSS, typography, color scheme
│   └── utils/               # Utility functions
├── astro.config.mjs         # Astro + Mintlify integration config
├── tsconfig.json
└── package.json
```

## How it works

The `@mintlify/astro` integration connects three parts: the Astro build system, your content in `docs/`, and the Mintlify packages that process and render that content.

### Astro configuration

The integration is configured in `astro.config.mjs`:

```javascript
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import { mintlify } from '@mintlify/astro';

export default defineConfig({
  integrations: [mintlify({ docsDir: './docs' }), react(), mdx()],
});
```

At build time, the integration reads `docs.json` and your MDX files, processes them into `.mintlify/docs/`, and Astro's content collections pick them up.

### Content

Documentation lives in `docs/` as MDX files, structured like any Mintlify project. MDX files use standard Mintlify [frontmatter](https://mintlify.com/docs/organize/pages#page-metadata) and can use Mintlify components without importing them. Navigation and site metadata are configured in `docs/docs.json`.

### Routing and navigation

A catch-all route at `src/pages/[...slug].astro` renders each MDX page. The `@mintlify/astro/helpers` package provides:

- `resolvePageData()` — returns tabs, sidebar navigation, footer links, and anchors for a given page path.
- `unwrapNav()` — flattens the navigation tree into a list for sidebar rendering.

## Customization

You have full control over the presentation layer. Key files to customize:

| File                                 | Purpose                                     |
| ------------------------------------ | ------------------------------------------- |
| `src/layouts/Layout.astro`           | Root HTML layout                            |
| `src/pages/[...slug].astro`          | Page template and data loading              |
| `src/components/Header.astro`        | Site header                                 |
| `src/components/Sidebar/`            | Sidebar navigation                          |
| `src/components/TableOfContents.tsx` | On-page table of contents                   |
| `src/styles/`                        | Global styles, typography, and color scheme |

## Search and AI assistant

> Requires a [Pro or Enterprise plan](https://mintlify.com/pricing).

The starter includes search and assistant components that connect to Mintlify's APIs. Both require the `PUBLIC_MINTLIFY_SUBDOMAIN` and `PUBLIC_MINTLIFY_ASSISTANT_KEY` environment variables.

- **Search** — the `SearchBar` component in `src/components/SearchBar.tsx` queries the Mintlify search API.
- **Assistant** — the `Assistant` component in `src/components/Assistant/` provides an AI chat interface that answers questions using your documentation content.

## Available scripts

| Command            | Description                          |
| ------------------ | ------------------------------------ |
| `npm run dev`      | Start the development server         |
| `npm run build`    | Build the site for production        |
| `npm run preview`  | Preview the production build locally |
| `npm run format`   | Format code with Prettier            |
| `npm run lint`     | Run ESLint                           |
| `npm run lint:fix` | Run ESLint with auto-fix             |

## AI-assisted writing

Set up your AI coding tool to work with Mintlify:

```bash
npx skills add https://mintlify.com/docs
```

This installs Mintlify's documentation skill for tools like Claude Code, Cursor, Windsurf, and others — including component reference, writing standards, and workflow guidance.

## Resources

- [Create a custom frontend guide](https://www.mintlify.com/docs/guides/custom-frontend)
- [Mintlify documentation](https://mintlify.com/docs)
- [Astro documentation](https://docs.astro.build)
- [Contributing guide](./CONTRIBUTING.md)
- [Development guide](./DEVELOPMENT.md)
