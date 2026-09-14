# Learned skill framework acceptance

This private test harness runs native Python LangGraph, Google ADK, and .NET Agent Framework agents against AIMock and the real Intelligence delivery API. It checks catalog discovery, developer instructions, both stable tools, supporting file content, and silent SDK output. The Intelligence repository owns the database fixtures, API server, and managed/self-hosted test matrix.

## Run with the real API fixture

1. Install this workspace with `pnpm install --frozen-lockfile`.
2. Install Python 3.11 or later, uv, and .NET SDK 9 with the .NET 8 runtime.
3. In the Intelligence checkout, set `APP_LEARNED_SKILLS_ADAPTER_REPO` to this checkout and `APP_LEARNED_SKILLS_TEST_DATABASE_URL` to an isolated, migrated test database.
4. Run `pnpm nx run @cpki/app-api:test-skill-frameworks` in the Intelligence checkout.

The server fixture supplies temporary project credentials and the delivery URL. No model API key is required. The harness uses POSIX process groups for deadline cleanup and runs on Linux and macOS.

## Verify independent Python packages

Run `pnpm nx run learned-skill-conformance:verify-python-distributions`.

This builds both adapter wheels and the canonical client, installs them outside the checkout, and removes each adapter in turn. It checks that the remaining adapter still imports and that each wheel owns an identical private copy of the delivery core.

TypeScript acceptance remains blocked on the upstream LangChain middleware fix required for the PRD API.
