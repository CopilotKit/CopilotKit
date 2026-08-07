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
