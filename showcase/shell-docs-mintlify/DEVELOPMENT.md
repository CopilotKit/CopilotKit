# Development Guide

This guide covers how to set up and work on the Mintlify Astro Starter locally.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20.0.0
- [npm](https://www.npmjs.com/) >= 10.0.0

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/mintlify/mintlify-astro-starter.git
cd mintlify-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file from the example:

```bash
cp .env.example .env
```

4. Fill in your Mintlify credentials in `.env`:

```
PUBLIC_MINTLIFY_ASSISTANT_KEY=your_assistant_key
PUBLIC_MINTLIFY_SUBDOMAIN=your_subdomain
```

5. Start the dev server:

```bash
npm run dev
```

The site will be available at `http://localhost:4321`.

## Available Scripts

| Command            | Description                          |
| ------------------ | ------------------------------------ |
| `npm run dev`      | Start the development server         |
| `npm run build`    | Build the site for production        |
| `npm run preview`  | Preview the production build locally |
| `npm run format`   | Format code with Prettier            |
| `npm run lint`     | Run ESLint                           |
| `npm run lint:fix` | Run ESLint with auto-fix             |

## Project Structure

```
├── docs/                # Documentation content (MDX pages, images, config)
│   ├── docs.json        # Navigation and site configuration
│   ├── index.mdx        # Homepage
│   └── ...
├── src/
│   ├── components/      # React and Astro components
│   ├── hooks/           # Custom React hooks
│   ├── icons/           # SVG icon components
│   ├── layouts/         # Astro layout templates
│   ├── pages/           # Astro page routes
│   ├── styles/          # Global CSS and Tailwind styles
│   └── utils/           # Utility functions
├── astro.config.mjs     # Astro configuration
├── tsconfig.json        # TypeScript configuration
└── package.json
```

## Customizing Content

Documentation pages live in the `docs/` directory as MDX files. Site navigation and metadata are configured in `docs/docs.json`.

See the [Mintlify documentation](https://mintlify.com/docs) for details on available components and configuration options.
