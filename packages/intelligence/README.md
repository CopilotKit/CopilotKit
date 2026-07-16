# @copilotkit/intelligence

Canonical public contracts and SDK surface for the CopilotKit Intelligence
Learning Platform.

The exported Zod 4 schemas are the source of truth for the versioned V1 DTOs
shared by CopilotKit runtimes, Intelligence services, and language SDKs. The
package also exports generated JSON Schema objects for language-neutral
conformance tooling.

```ts
import {
  learningContainerV1Schema,
  runSnapshotV1Schema,
  skillSetProjectionV1Schema,
} from "@copilotkit/intelligence";

const container = learningContainerV1Schema.parse(response);
const snapshot = runSnapshotV1Schema.parse(snapshotPayload);
const projection = skillSetProjectionV1Schema.parse(registryResponse);
```

The contracts intentionally model one nullable learning-container assignment
per thread. Runtime/browser code must not infer a default container or treat a
browser-provided value as assignment authority.

## Registry SDK

The Node.js registry SDK retrieves, verifies, and atomically installs the
current skill set. `get()` always contacts the registry and never silently
falls back to stale data. Offline use is explicit through `getCached()`, which
fully verifies every cached manifest and file before returning it.

```ts
import { IntelligenceClient } from "@copilotkit/intelligence";

const intelligence = new IntelligenceClient({
  baseUrl: "https://intelligence.example.com",
  accessToken: () => process.env.COPILOTKIT_INTELLIGENCE_TOKEN!,
  projectNamespace: "my-project",
  cacheRoot: ".copilotkit/intelligence",
});

const current = await intelligence.skills.get({
  learningContainerId: "55555555-5555-4555-8555-555555555555",
});
```

The shared cache is namespaced at
`v1/<sha256(projectNamespace)>/<learningContainerId>/`. Immutable sets live
under `sets/<skillSetHash>`, while `.copilotkit-current.json` is an atomically
replaced pointer. Registry entries include the canonical artifact manifest as
the loose `manifest` field; bundle ZIPs contain one root directory and exactly
the manifest files in manifest order. A fetch-compatible `transport` can be
injected for custom networking and tests. Canonical API failures surface as
`IntelligenceSdkError` with stable code, category, retryability, and correlation
IDs.
