/** Canonical coding-agent prompt for completing Rich Threads Runtime setup. */
export const RICH_THREADS_SETUP_PROMPT = `Read https://docs.copilotkit.ai/backend/runtime-endpoints#enable-rich-threads-routes and finish setting up Rich Threads in this repository.

First inspect the repository's agent instructions, installed CopilotKit versions, Runtime adapter, frontend provider, route or proxy setup, and existing authentication. Preserve the current framework and deployment model. Preserve existing authentication middleware and access checks on every Runtime route.

Follow the guide to enable the multi-route Runtime, align the frontend transport, scope identifyUser to the existing server-verified signed-in application user, and expose the full Runtime subtree for GET, POST, PATCH, and DELETE. Never use a fixed demo identity in production. If no trusted user identity exists, stop and ask me which auth source to use.

Start the app and verify GET {basePath}/info reports threadEndpoints.list, inspect, mutations, and realtimeMetadata as true. Run focused tests, lint, and typecheck. Report the files changed, commands run, and verification result. If blocked, explain the missing input; do not invent setup.`;
