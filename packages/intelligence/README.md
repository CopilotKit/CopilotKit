# @copilotkit/intelligence

Canonical public contracts and SDK surface for the CopilotKit Intelligence
Learning Platform.

The exported Zod 4 schemas are the source of truth for the versioned V1 DTOs
shared by CopilotKit runtimes, Intelligence services, and language SDKs. The
package also exports generated JSON Schema objects for language-neutral
conformance tooling.

Generated JSON Schema includes standard `if`/`then` constraints for candidate
action coherence. Candidate subject-hash equality is carried by the portable
`x-copilotkit-equal-properties` keyword. Each keyword value is an array of
`[leftProperty, rightProperty]` pairs; a conforming validator must reject the
containing object when a pair's values differ. Equality-bearing schemas declare
the required candidate-semantics vocabulary through their custom `$schema` URI;
validators that do not implement it must reject the schema instead of ignoring
the keyword. The corpus publishes that meta-schema in `metaSchemas` and executes
both the standard conditionals and required keyword against a JSON Schema
validator, including add, update, and remove hash-mismatch cases.

In particular, the
`generated-remove-candidate-requires-non-empty-removal-intent` case requires a
generated `remove` candidate's `removalIntent` to contain at least one own
property. No specific property name is required; generated `add` and `update`
candidates continue to require a null removal intent.

Generated `add` candidates create a new root identity, so both `skillId` and
`parentVersionId` must be null. Generated `update` and `remove` candidates
instead require both fields to identify the exact existing target.

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
the required `manifest` field; bundle ZIPs contain one root directory and exactly
the manifest files in manifest order. A fetch-compatible `transport` can be
injected for custom networking and tests. Canonical API failures surface as
`IntelligenceSdkError` with stable code, category, retryability, and correlation
IDs.
