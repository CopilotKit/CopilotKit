import {
  GenerateSandboxedUiArgsSchema,
  OpenGenerativeUIContentSchema as ContentSchema,
} from "@copilotkit/vue";
import { CopilotA2UIRecovery } from "@copilotkit/angular";
import { Catalog, filterCatalog } from "@copilotkit/a2ui-renderer";
import { z } from "zod";

declare const catalog: Catalog<{ name: string; schema: z.ZodTypeAny }>;
declare const recovery: CopilotA2UIRecovery;

export const visible = filterCatalog<{ name: string; schema: z.ZodTypeAny }>(
  catalog,
  (name) => name !== "Badge",
);

export function readContent(value: unknown) {
  const content = ContentSchema.parse(value);
  return content.html;
}

export function isArgs(value: unknown) {
  return GenerateSandboxedUiArgsSchema.safeParse(value).success;
}

export const shape = ContentSchema.shape;

export const message = z.object({ content: ContentSchema });

export const status = recovery.lifecycle().status;
