# CopilotKit v1.57.3

A patch release on the `1.57` line. Re-publishes the monorepo to repair an issue in the `1.57.2` artifacts.

## Install

```bash
npm install @copilotkit/react-core@1.57.3 @copilotkit/react-ui@1.57.3 @copilotkit/runtime@1.57.3
```

## Fixes

- **Re-publishes the `1.57` line** — `1.57.2` shipped a broken artifact. `1.57.3` re-cuts every package in the monorepo scope at a single matching version so installs and peer-dep resolution line up across the `1.57` line. No behavior changes versus `1.57.2`.

## Packages republished at `1.57.3`

`@copilotkit/runtime`, `@copilotkit/react-core`, `@copilotkit/react-ui`, `@copilotkit/react-native`, `@copilotkit/vue`, `@copilotkit/core`, `@copilotkit/shared`, `@copilotkit/runtime-client-gql`, `@copilotkit/sdk-js`, `@copilotkit/voice`, `@copilotkit/web-inspector`, `@copilotkit/a2ui-renderer`, `@copilotkit/react-textarea`, `@copilotkit/sqlite-runner`, and `@copilotkit/agentcore-runner`.
