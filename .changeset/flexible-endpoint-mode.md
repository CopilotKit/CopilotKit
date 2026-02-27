---
"@copilotkit/react-core": patch
---

fix(react-core): allow overriding useSingleEndpoint in CopilotKit provider

The V1 `<CopilotKit>` provider previously hardcoded `useSingleEndpoint={true}` when wrapping the V2 provider, preventing users from opting into REST transport mode. The prop is now passed through from user config, defaulting to `true` to preserve backward compatibility.
