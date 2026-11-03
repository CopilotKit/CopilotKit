import {
  GenerateSandboxedUiArgsSchema,
  OpenGenerativeUIContentSchema as ContentSchema,
} from "@copilotkit/vue";
// TODO(copilotkit-2.0): `CopilotA2UIRecovery` no longer exposes `lifecycle`, `retryRevealed`, `debugExposure`, `label`, `phase`, `failureDiagnostics` or `retryDiagnostics`. Read the lifecycle from the activity content with `readA2UILifecycleContent`. See https://docs.copilotkit.ai/migrate/generative-ui-2.0
import { CopilotA2UIRecovery } from "@copilotkit/angular";
import { Catalog, filterCatalog } from "@copilotkit/a2ui-renderer";
import { z } from "zod";

declare const catalog: Catalog<{ name: string; schema: z.ZodTypeAny }>;
declare const recovery: CopilotA2UIRecovery;

export const visible = filterCatalog(
  catalog,
  (name) => name !== "Badge",
);

export function readContent(value: unknown) {
  // TODO(copilotkit-2.0): `OpenGenerativeUIContentSchema` is a Standard Schema in 2.0, not a zod schema, so `.parse()` does not exist. Use `OpenGenerativeUIContentSchema["~standard"].validate(value)`: it returns `{ value }` or `{ issues }` and does not throw. See https://docs.copilotkit.ai/migrate/generative-ui-2.0
  const content = ContentSchema.parse(value);
  return content.html;
}

export function isArgs(value: unknown) {
  // TODO(copilotkit-2.0): `GenerateSandboxedUiArgsSchema` is a Standard Schema in 2.0, not a zod schema, so `.safeParse()` does not exist. Use `GenerateSandboxedUiArgsSchema["~standard"].validate(value)`: it returns `{ value }` or `{ issues }` and does not throw. See https://docs.copilotkit.ai/migrate/generative-ui-2.0
  return GenerateSandboxedUiArgsSchema.safeParse(value).success;
}

// TODO(copilotkit-2.0): `OpenGenerativeUIContentSchema` is a Standard Schema in 2.0, not a zod schema, so `.shape` does not exist. It has only `["~standard"]`. See https://docs.copilotkit.ai/migrate/generative-ui-2.0
export const shape = ContentSchema.shape;

// TODO(copilotkit-2.0): `OpenGenerativeUIContentSchema` is a Standard Schema in 2.0, not a zod schema, so it cannot be part of a zod schema. Write the fields in zod yourself, or validate with `OpenGenerativeUIContentSchema["~standard"].validate(value)`. See https://docs.copilotkit.ai/migrate/generative-ui-2.0
export const message = z.object({ content: ContentSchema });

export const status = recovery.lifecycle().status;
