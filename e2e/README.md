# E2E Tests - Simplified

## Overview

This directory contains end-to-end tests for CopilotKit example applications. We've simplified the approach to run individual apps and tests in parallel.

## Structure

- **Individual App Commands**: Each app can be started with `pnpm run start:<app-name>`
- **Individual Test Commands**: Each app can be tested with `pnpm run test:<app-name>`
- **Parallel CI**: GitHub Actions runs tests in parallel using matrix strategy

## Available Commands

### Start Individual Apps

```bash
pnpm run start:qa             # Start QA app (agent only)
pnpm run start:research-canvas # Start Research Canvas (agent + UI)
pnpm run start:travel         # Start Travel app (agent + UI)
```

### Run Individual Tests

```bash
pnpm run test:qa             # Test QA app
pnpm run test:research-canvas # Test Research Canvas
pnpm run test:travel         # Test Travel app
```

### Development

```bash
pnpm setup                   # Install Playwright
pnpm test                    # Run all tests
pnpm test:headed             # Run with browser visible
pnpm test:ui                 # Interactive test runner
```

## Adding New Tests

1. **Create test file**: `tests/<app-name>.spec.ts`
2. **Add start script**: Update `package.json` with `start:<app-name>`
3. **Add test script**: Update `package.json` with `test:<app-name>`
4. **Add to CI**: Include app name in `.github/workflows/e2e-simple.yml` matrix

## Environment Variables

Tests use these environment variables (with defaults):

- `AGENT_URL` - Agent endpoint (default: http://localhost:8000)
- `UI_URL` - Frontend endpoint (default: http://localhost:3000)
- `OPENAI_API_KEY` - Required for agent functionality
- `TAVILY_API_KEY` - Required for research apps
- `GOOGLE_MAPS_API_KEY` - Required for travel app

## Migration from Poetry to uv

All Python agents now use `uv` for dependency management:

- **Faster**: 100-600ms vs poetry's 3-10+ seconds
- **Compatible**: Works with mixed pip/LangGraph workflows
- **Simplified**: `uv sync` instead of `poetry install`

## CI/CD

The `e2e-simple.yml` workflow runs tests in parallel:

- Each app gets its own container
- Tests run independently
- Faster overall execution
- Individual artifact uploads on failure

## Troubleshooting

- **Agent not starting**: Check `uv sync` completed successfully
- **UI not loading**: Ensure frontend dependencies installed with `pnpm install`
- **Tests timing out**: Increase wait time in test scripts
- **Port conflicts**: Each app uses different ports (8001-8007, 3001-3007)
