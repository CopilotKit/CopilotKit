// GENERATED FILE — DO NOT EDIT BY HAND.
// Regenerate with: pnpm exec tsx scripts/deprecations/removed-exports.mts generate
//
// Stand-ins for the CopilotKit 1.x exports that 2.0 removed from @copilotkit/shared.
// Calling, constructing, or rendering one throws a CopilotKitRemovedApiError,
// and importing one does not. TypeScript fails on the same code with the same
// message. The replacements are in packages/shared/src/removed-exports-table.ts.

import { removedApi } from "./utils/removed-api";
import type { RemovedType } from "./utils/removed-api";

/** @deprecated "A2UICatalogSchemaSource" was removed in CopilotKit 2.0. The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UICatalogSchemaSource = RemovedType<
  "A2UICatalogSchemaSource",
  "The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package.",
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "A2UICommonTypes" was removed in CopilotKit 2.0. The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UICommonTypes = RemovedType<
  "A2UICommonTypes",
  "The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package.",
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "A2UIFunctionSchema" was removed in CopilotKit 2.0. The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UIFunctionSchema = RemovedType<
  "A2UIFunctionSchema",
  "The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package.",
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "A2UIInlineCatalogSchema" was removed in CopilotKit 2.0. The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UIInlineCatalogSchema = RemovedType<
  "A2UIInlineCatalogSchema",
  "The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package.",
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "A2UIRuntimeInfo" was removed in CopilotKit 2.0. The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export type A2UIRuntimeInfo = RemovedType<
  "A2UIRuntimeInfo",
  "The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package.",
  "/migrate/generative-ui-2.0#a2ui-v09-renderer"
>;

/** @deprecated "BaseCondition" was removed in CopilotKit 2.0. Delete the code, or keep your own copy of it. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export type BaseCondition = RemovedType<
  "BaseCondition",
  "Delete the code, or keep your own copy of it.",
  "/migrate/shared-2.0#removed-helpers"
>;

/** @deprecated "buildA2UICatalogContextValue" was removed in CopilotKit 2.0. The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export const buildA2UICatalogContextValue = /*#__PURE__*/ removedApi({
  name: "buildA2UICatalogContextValue",
  use: "The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package.",
  docs: "/migrate/generative-ui-2.0#a2ui-v09-renderer",
});

/** @deprecated "ComparisonCondition" was removed in CopilotKit 2.0. Delete the code, or keep your own copy of it. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export type ComparisonCondition = RemovedType<
  "ComparisonCondition",
  "Delete the code, or keep your own copy of it.",
  "/migrate/shared-2.0#removed-helpers"
>;

/** @deprecated "ComparisonRule" was removed in CopilotKit 2.0. Delete the code, or keep your own copy of it. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export type ComparisonRule = RemovedType<
  "ComparisonRule",
  "Delete the code, or keep your own copy of it.",
  "/migrate/shared-2.0#removed-helpers"
>;

/** @deprecated "Condition" was removed in CopilotKit 2.0. Delete the code, or keep your own copy of it. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export type Condition = RemovedType<
  "Condition",
  "Delete the code, or keep your own copy of it.",
  "/migrate/shared-2.0#removed-helpers"
>;

/** @deprecated "convertJsonSchemaToZodSchema" was removed in CopilotKit 2.0. Keep your own copy of the function, or import it from @copilotkit/runtime/agent/ai-sdk on the server. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export const convertJsonSchemaToZodSchema = /*#__PURE__*/ removedApi({
  name: "convertJsonSchemaToZodSchema",
  use: "Keep your own copy of the function, or import it from @copilotkit/runtime/agent/ai-sdk on the server.",
  docs: "/migrate/shared-2.0#removed-helpers",
});

/** @deprecated "CopilotKitVersionMismatchError" was removed in CopilotKit 2.0. Delete the code. CopilotKit 2.0 has no GraphQL runtime client to compare versions with. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export const CopilotKitVersionMismatchError = /*#__PURE__*/ removedApi({
  name: "CopilotKitVersionMismatchError",
  use: "Delete the code. CopilotKit 2.0 has no GraphQL runtime client to compare versions with.",
  docs: "/migrate/shared-2.0#removed-helpers",
});
/** @deprecated "CopilotKitVersionMismatchError" was removed in CopilotKit 2.0. Delete the code. CopilotKit 2.0 has no GraphQL runtime client to compare versions with. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export type CopilotKitVersionMismatchError =
  typeof CopilotKitVersionMismatchError;

/** @deprecated "dataToUUID" was removed in CopilotKit 2.0. Use v5 and validate from the uuid package. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export const dataToUUID = /*#__PURE__*/ removedApi({
  name: "dataToUUID",
  use: "Use v5 and validate from the uuid package.",
  docs: "/migrate/shared-2.0#removed-helpers",
});

/** @deprecated "executeConditions" was removed in CopilotKit 2.0. Delete the code, or keep your own copy of it. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export const executeConditions = /*#__PURE__*/ removedApi({
  name: "executeConditions",
  use: "Delete the code, or keep your own copy of it.",
  docs: "/migrate/shared-2.0#removed-helpers",
});

/** @deprecated "ExistenceCondition" was removed in CopilotKit 2.0. Delete the code, or keep your own copy of it. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export type ExistenceCondition = RemovedType<
  "ExistenceCondition",
  "Delete the code, or keep your own copy of it.",
  "/migrate/shared-2.0#removed-helpers"
>;

/** @deprecated "ExistenceRule" was removed in CopilotKit 2.0. Delete the code, or keep your own copy of it. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export type ExistenceRule = RemovedType<
  "ExistenceRule",
  "Delete the code, or keep your own copy of it.",
  "/migrate/shared-2.0#removed-helpers"
>;

/** @deprecated "extractA2UICatalogSchemas" was removed in CopilotKit 2.0. The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export const extractA2UICatalogSchemas = /*#__PURE__*/ removedApi({
  name: "extractA2UICatalogSchemas",
  use: "The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package.",
  docs: "/migrate/generative-ui-2.0#a2ui-v09-renderer",
});

/** @deprecated "getPossibleVersionMismatch" was removed in CopilotKit 2.0. Delete the code. CopilotKit 2.0 has no GraphQL runtime client to compare versions with. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export const getPossibleVersionMismatch = /*#__PURE__*/ removedApi({
  name: "getPossibleVersionMismatch",
  use: "Delete the code. CopilotKit 2.0 has no GraphQL runtime client to compare versions with.",
  docs: "/migrate/shared-2.0#removed-helpers",
});

/** @deprecated "getZodParameters" was removed in CopilotKit 2.0. Keep your own copy of the function. For the JSON Schema of a v1 Parameter[], use actionParametersToJsonSchema from @copilotkit/shared. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export const getZodParameters = /*#__PURE__*/ removedApi({
  name: "getZodParameters",
  use: "Keep your own copy of the function. For the JSON Schema of a v1 Parameter[], use actionParametersToJsonSchema from @copilotkit/shared.",
  docs: "/migrate/shared-2.0#removed-helpers",
});

/** @deprecated "ImageData" was removed in CopilotKit 2.0. Put an ImageInputPart from @copilotkit/shared in the content of the user message. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/removed-apis-2.0#message-types-from-copilotkitshared */
export type ImageData = RemovedType<
  "ImageData",
  "Put an ImageInputPart from @copilotkit/shared in the content of the user message.",
  "/migrate/removed-apis-2.0#message-types-from-copilotkitshared"
>;

/** @deprecated "isValidUUID" was removed in CopilotKit 2.0. Use v5 and validate from the uuid package. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export const isValidUUID = /*#__PURE__*/ removedApi({
  name: "isValidUUID",
  use: "Use v5 and validate from the uuid package.",
  docs: "/migrate/shared-2.0#removed-helpers",
});

/** @deprecated "logCopilotKitPlatformMessage" was removed in CopilotKit 2.0. Delete the code, or use console.log with %c styles. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export const logCopilotKitPlatformMessage = /*#__PURE__*/ removedApi({
  name: "logCopilotKitPlatformMessage",
  use: "Delete the code, or use console.log with %c styles.",
  docs: "/migrate/shared-2.0#removed-helpers",
});

/** @deprecated "LogicalCondition" was removed in CopilotKit 2.0. Delete the code, or keep your own copy of it. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export type LogicalCondition = RemovedType<
  "LogicalCondition",
  "Delete the code, or keep your own copy of it.",
  "/migrate/shared-2.0#removed-helpers"
>;

/** @deprecated "LogicalRule" was removed in CopilotKit 2.0. Delete the code, or keep your own copy of it. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export type LogicalRule = RemovedType<
  "LogicalRule",
  "Delete the code, or keep your own copy of it.",
  "/migrate/shared-2.0#removed-helpers"
>;

/** @deprecated "logStyled" was removed in CopilotKit 2.0. Delete the code, or use console.log with %c styles. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export const logStyled = /*#__PURE__*/ removedApi({
  name: "logStyled",
  use: "Delete the code, or use console.log with %c styles.",
  docs: "/migrate/shared-2.0#removed-helpers",
});

/** @deprecated "publicApiKeyRequired" was removed in CopilotKit 2.0. Delete the code, or use console.log with %c styles. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export const publicApiKeyRequired = /*#__PURE__*/ removedApi({
  name: "publicApiKeyRequired",
  use: "Delete the code, or use console.log with %c styles.",
  docs: "/migrate/shared-2.0#removed-helpers",
});

/** @deprecated "Rule" was removed in CopilotKit 2.0. Delete the code, or keep your own copy of it. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#removed-helpers */
export type Rule = RemovedType<
  "Rule",
  "Delete the code, or keep your own copy of it.",
  "/migrate/shared-2.0#removed-helpers"
>;

/** @deprecated "SchemaToJsonSchemaOptions" was removed in CopilotKit 2.0. schemaToJsonSchema from @copilotkit/shared takes no options. It reads the JSON Schema from the schema, which needs Zod 4.2 or later. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/v2#upgrade-to-zod-42-or-later */
export type SchemaToJsonSchemaOptions = RemovedType<
  "SchemaToJsonSchemaOptions",
  "schemaToJsonSchema from @copilotkit/shared takes no options. It reads the JSON Schema from the schema, which needs Zod 4.2 or later.",
  "/migrate/v2#upgrade-to-zod-42-or-later"
>;

/** @deprecated "serializeA2UISchema" was removed in CopilotKit 2.0. The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/generative-ui-2.0#a2ui-v09-renderer */
export const serializeA2UISchema = /*#__PURE__*/ removedApi({
  name: "serializeA2UISchema",
  use: "The A2UI v0.9 catalog helpers were removed. Declare the components with createGenerativeUI, and get the catalog schema with exportA2UICatalog(ui), both from the /generative-ui entry of your framework package.",
  docs: "/migrate/generative-ui-2.0#a2ui-v09-renderer",
});

/** @deprecated "TelemetryCapture" was removed in CopilotKit 2.0. Delete the import. @copilotkit/runtime has its own telemetry client. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#telemetry-entry-point-removed */
export type TelemetryCapture = RemovedType<
  "TelemetryCapture",
  "Delete the import. @copilotkit/runtime has its own telemetry client.",
  "/migrate/shared-2.0#telemetry-entry-point-removed"
>;

/** @deprecated "TelemetryIdentity" was removed in CopilotKit 2.0. Delete the import. @copilotkit/runtime has its own telemetry client. Run `npx copilotkit@latest migrate` to update your code. See https://docs.copilotkit.ai/migrate/shared-2.0#telemetry-entry-point-removed */
export type TelemetryIdentity = RemovedType<
  "TelemetryIdentity",
  "Delete the import. @copilotkit/runtime has its own telemetry client.",
  "/migrate/shared-2.0#telemetry-entry-point-removed"
>;
