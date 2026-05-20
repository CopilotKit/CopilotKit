---
"@copilotkit/runtime": patch
"@copilotkit/shared": patch
---

chore: bump `@copilotkit/license-verifier` to `0.2.0`

The license verifier's `LicensePayload` now includes a required `telemetry_id`
field. Runtime code paths that consume verified payloads continue to work
unchanged; the re-exported `LicensePayload` type on `@copilotkit/shared` now
requires `telemetry_id` on literals (see ENT-251 on the intelligence side for
the motivation).
