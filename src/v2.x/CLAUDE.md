# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Rules

- NEVER commit or push to the repository unless explicitly asked to
- NEVER credit yourself in commit messages (no "Generated with Claude Code" or similar)

## Common Commands

### Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Build specific package
pnpm turbo run build --filter=@copilotkitnext/react

# Clean all dist outputs
pnpm clean
```

**Development Workflow - Run Order (Important):**

1. **Always start package compilers first:**

   ```bash
   pnpm dev  # Watches and compiles libraries only
   ```
   - Includes: @copilotkitnext/core, @copilotkitnext/shared, @copilotkitnext/runtime, @copilotkitnext/react, @copilotkitnext/angular
   - Produces dist and styles.css with hot reload for dependent apps
   - Wait for this to be ready before starting apps

2. **Then run demos/storybooks/docs in separate terminals as needed:**

   ```bash
   # Angular demo + backend server
   pnpm demo:angular
   # Frontend: apps/angular/demo (ng serve on port 4200)
   # Backend: apps/angular/demo-server (Hono API on port 3001)

   # Angular Storybook
   pnpm storybook:angular
   # Port 6007 with --no-open flag

   # React demo (Next.js)
   pnpm demo:react
   # Port 3000

   # React Storybook
   pnpm storybook:react
   # Port 6006 with --no-open flag

   # Documentation site
   pnpm docs
   # Mintlify on port 4000
   ```

**Important Notes:**

- Demos and storybooks depend on `pnpm dev` for compiled outputs
- No upstream builds for apps - they rely on the watch mode from `pnpm dev`
- All apps have hot reload enabled

### Testing & Quality

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Type checking
pnpm check-types

# Linting
pnpm lint

# Code formatting
pnpm format
```

### Storybook

```bash
# Start Storybook development server
pnpm storybook

# Build Storybook for production
pnpm build-storybook
```

#### Storybook Story Guidelines

When creating or modifying Storybook stories, especially for Angular components:

1. **Always manually provide source code** - Do not rely on automatic source extraction. Use the `parameters.docs.source` configuration:

   ```typescript
   parameters: {
     docs: {
       source: {
         type: 'code',
         code: `// Your complete example code here`,
         language: 'typescript', // or 'html'
       },
     },
   },
   ```

2. **Show complete, working examples** - The code in the source panel should be a complete, copy-pasteable example that shows all necessary imports, component definitions, and event handlers.

## Architecture Overview

CopilotKit vnext_experimental is a TypeScript-first monorepo built with React components and AI agents. The codebase follows a modular workspace architecture managed by Turbo and pnpm.

### Package Structure

- **`packages/core`** - Core utilities, types, and foundational logic
- **`packages/react`** - React components, hooks, and providers for building copilot interfaces
- **`packages/runtime`** - Server-side runtime utilities, handlers, and API endpoints
- **`packages/shared`** - Common utilities shared across packages
- **`packages/eslint-config`** - Shared ESLint configuration
- **`packages/typescript-config`** - TypeScript configuration presets

### Application Structure

- **`apps/demo`** - Next.js demo application showcasing CopilotKit features
- **`apps/docs`** - Documentation site built with Mintlify
- **`apps/storybook`** - Component documentation and interactive examples

## Development Guidelines

### Web Development and UI Testing

- **Always verify UI changes with Playwright MCP when available** - When working on web UI components, especially when matching behavior between frameworks (React/Angular), use Playwright to verify that changes work correctly
- **Don't stop until functionality is confirmed** - Continue working on UI issues until they are fully resolved and verified with Playwright or other testing tools
- **Test interactively** - Use Playwright to interact with components (clicking buttons, scrolling, etc.) to ensure they behave as expected

### Package Management

- Always use `pnpm` for package management (never use `npm`)
- Add workspace dependencies with `pnpm add -w <pkg>`
- Keep scripts standardized across packages: `build`, `dev`, `lint`, `check-types`, `test`, `test:watch`

### Code Organization

- React components are in `packages/react/src/components/`
- Server-side logic belongs in `packages/runtime/src/`
- Shared utilities go in `packages/shared/src/`
- Tests are located in `src/__tests__/` directories within each package
- Build outputs (`dist/`, `.next/`) are never committed

### Key Technologies

- **TypeScript 5.8.2** for type safety
- **React 18+** for UI components
- **Tailwind CSS** for styling (with custom build process)
- **Vitest** for testing with jsdom environment
- **Turbo** for monorepo task orchestration
- **@ag-ui** for core AI agent functionality

### Testing

- Tests use Vitest with jsdom environment
- React components tested with @testing-library/react
- Runtime code uses Node environment for testing
- Coverage reports available via `test:coverage`

#### Angular Testing Patterns

**Important findings from testing Angular directives and components:**

1. **Dependency Injection Context Issues**
   - Angular's `inject()` function must be called in an injection context
   - Cannot directly instantiate directives/components that use `inject()` in tests
   - Use `TestBed.createComponent()` for testing components with DI dependencies
   - Prefer field initializers over `ngOnInit` for `inject()` calls when possible

2. **Memory Issues with Test Components**
   - Declaring too many Angular components at module level can cause "JavaScript heap out of memory" errors
   - Keep test components minimal and focused
   - Consider declaring simple test components inside test functions (like `CopilotKitAgentContextDirective` tests)
   - If experiencing memory issues, reduce the number of test components or split tests across files

3. **TestBed Configuration**
   - Cannot call `TestBed.configureTestingModule()` multiple times in the same test
   - Components declared with `@Component` decorator can import their own dependencies (directives, etc.)
   - Use `providers: [provideCopilotKit({})]` in TestBed or component decorator for CopilotKit services

4. **Directive Testing Patterns**
   - For directives using field injection (`inject()`), test through host components
   - For directives with constructor injection, can test more directly
   - Follow existing patterns in `copilotkit-agent-context.directive.spec.ts` for reference

### Build Process

- React package builds both TypeScript and CSS (Tailwind)
- Runtime package compiles TypeScript from `src/` to `dist/`
- Turbo handles dependency ordering and caching
- Development mode supports watch mode across all packages
