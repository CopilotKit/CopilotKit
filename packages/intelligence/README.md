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
containing object when a pair's values differ. Cross-property and cross-array
rules use the bounded `x-copilotkit-assertions` keyword. Both keywords belong to
the versioned Learning Contract portable-validator capability advertised by the
custom `$schema` URI.

`$vocabulary` advertises the requirement but is not, by itself, a capability
handshake for every JSON Schema implementation. In particular, permissive Ajv
configuration can ignore an unknown required keyword. JavaScript consumers must
use the package-owned registration and compile entry point, which checks the
meta-schema and both keyword implementations before schema compilation:

```ts
import {
  createLearningContractJsonSchemaValidator,
  learningContractJsonSchemas,
} from "@copilotkit/intelligence";

const portableValidator = createLearningContractJsonSchemaValidator();
const validateCandidate = portableValidator.compile(
  learningContractJsonSchemas.SkillCandidateV1,
);

if (!validateCandidate(candidatePayload)) {
  throw new Error("SkillCandidateV1 failed portable validation");
}
```

The supported facade owns its Ajv instance and disables coercion, defaults, and
other payload mutation. Caller-provided validator instances are rejected rather
than inspected through unstable implementation details. The lower-level adapter
exports are available for capability integrations, but calling raw
`ajv.compile()` is not a supported path for Learning Contract schemas. A
missing meta-schema raises
`LEARNING_CONTRACT_VALIDATOR_META_SCHEMA_MISSING`; missing or foreign keyword
registration raises `LEARNING_CONTRACT_VALIDATOR_CAPABILITY_MISSING`, before a
payload validator is returned. Non-JavaScript validators must provide the full
capability identified by
`LEARNING_CONTRACT_PORTABLE_VALIDATOR_CAPABILITY_V1` (version 1) and refuse the
schema when any declared semantic is unavailable.

The conformance corpus publishes the custom meta-schema in `metaSchemas`.
Package tests compile every emitted schema through the supported validator and
require every named corpus case to produce the same result under portable JSON
Schema validation, canonical Zod validation, and its declared `valid` value.
They also exercise every bounded assertion operation available to portable
overlays.

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
