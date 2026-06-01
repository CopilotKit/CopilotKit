---
"@copilotkitnext/angular": patch
---

fix(angular): disable the unlicensed watermark

The Angular SDK no longer renders the "CopilotKit Unlicensed" watermark (or logs
the related "License Required" console warning) when no CopilotCloud license key
is provided. The watermark implementation is kept in place and can be re-enabled
by flipping `LICENSE_WATERMARK_ENABLED` back to `true`. The `licenseKey` option
and its `X-CopilotCloud-Public-Api-Key` header injection are unchanged.
