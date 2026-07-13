# @copilotkit/channels

The compatibility facade for existing CopilotKit Channels consumers. In the current `0.1.x`
line, it forwards the platform-neutral engine, testing utilities, and JSX runtime from
`@copilotkit/channels-core`; it does not yet bundle adapter SDKs or expose adapter subpaths.

The planned `0.2.0` release will make `@copilotkit/channels` the batteries-included umbrella
distribution, with adapter subpaths added as part of that release.

For selective installs and adapter authoring today, use `@copilotkit/channels-core` plus the
individual adapter package.
