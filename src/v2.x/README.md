# CopilotKit vnext_experimental

A modern TypeScript-first copilot framework built with React components and AI agents.

## Development

### Prerequisites

- Node.js 18+
- pnpm 9+

### Setup

```bash
pnpm install
```

### Available Commands

#### Build

```bash
# Build all packages
pnpm turbo run build

# Build specific package
pnpm turbo run build --filter=@copilotkitnext/react
```

#### Development

```bash
# Run tests
pnpm turbo run test

# Run tests in watch mode
pnpm turbo run test:watch

# Type checking
pnpm turbo run check-types

# Linting
pnpm turbo run lint
```

#### Storybook

```bash
# Start Storybook development server
pnpm turbo run storybook:dev --filter=storybook

# Build Storybook for production
pnpm turbo run storybook:build --filter=storybook
```

### Package Structure

- `packages/core` - Core utilities and types
- `packages/react` - React components and hooks
- `packages/runtime` - Server-side runtime handlers
- `packages/shared` - Common utilities
- `apps/storybook` - Component documentation and examples
