---
"@copilotkit/runtime": patch
---

fix(runtime): isStreamConsumed false positive in async frameworks — req.complete and _readableState.ended become true after the HTTP parser receives bytes, not after app code reads the stream. In async pipelines like Next.js pages router, this caused bodyParser:false requests to silently send an empty body to Hono. Now relies only on req.readableEnded, which correctly signals app-level stream consumption.
