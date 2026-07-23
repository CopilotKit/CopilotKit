import type { SchemaToJsonSchemaOptions } from "@copilotkit/shared";
import { zodToJsonSchema } from "zod-to-json-schema";

type ZodToJsonSchemaInput = Parameters<typeof zodToJsonSchema>[0];
type ZodToJsonSchemaOptions = Parameters<typeof zodToJsonSchema>[1];

export const standardSchemaZodToJsonSchema: NonNullable<
  SchemaToJsonSchemaOptions["zodToJsonSchema"]
> = (schema, options) =>
  zodToJsonSchema(
    schema as ZodToJsonSchemaInput,
    options as ZodToJsonSchemaOptions,
  ) as Record<string, unknown>;
