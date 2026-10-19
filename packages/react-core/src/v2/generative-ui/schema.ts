import type { StandardSchemaV1 } from "@copilotkit/shared";

/** Any Standard Schema: zod, Valibot, ArkType, and more. */
export type GenerativeUISchema = StandardSchemaV1;

/** The output type of a schema: what validation gives back. */
export type SchemaOutput<Schema> =
  Schema extends StandardSchemaV1<any, infer Output> ? Output : never;

/** The input type of a schema: what validation takes. */
export type SchemaInput<Schema> =
  Schema extends StandardSchemaV1<infer Input, any> ? Input : never;

export type ValidationResult =
  | { success: true; data: unknown }
  | { success: false; issues: readonly StandardSchemaV1.Issue[] };

const ASYNC_ISSUE: StandardSchemaV1.Issue = {
  message:
    "the schema validates asynchronously; component props and state need a schema that validates synchronously",
};

function toResult(result: StandardSchemaV1.Result<unknown>): ValidationResult {
  return result.issues
    ? { success: false, issues: result.issues }
    : { success: true, data: result.value };
}

/**
 * Validates `value` with `schema`. The result comes back at once when the
 * schema validates synchronously, else as a promise.
 */
export function validateSchema(
  schema: StandardSchemaV1,
  value: unknown,
): ValidationResult | Promise<ValidationResult> {
  const result = schema["~standard"].validate(value);
  return result instanceof Promise ? result.then(toResult) : toResult(result);
}

/**
 * Validates `value` synchronously, for code that runs during render. A
 * schema that validates asynchronously fails with an issue that says so.
 */
export function validateSchemaSync(
  schema: StandardSchemaV1,
  value: unknown,
): ValidationResult {
  const result = validateSchema(schema, value);
  if (!(result instanceof Promise)) return result;
  // ponytail: the async result is dropped, because render cannot wait for it.
  result.catch(() => {});
  return { success: false, issues: [ASYNC_ISSUE] };
}

/** True for the issue that `validateSchemaSync` gives for an async schema. */
export function isAsyncIssue(issue: StandardSchemaV1.Issue) {
  return issue === ASYNC_ISSUE;
}

/** The first key of an issue path: the prop the issue is about. */
export function issueKey(issue: StandardSchemaV1.Issue) {
  const first = issue.path?.[0];
  const key = typeof first === "object" ? first.key : first;
  return key === undefined ? undefined : String(key);
}

/** `"a.b: message; c: message"`. A path-less issue gets `fallback`. */
export function formatIssues(
  issues: readonly StandardSchemaV1.Issue[],
  fallback = "props",
) {
  return issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((segment) =>
          String(typeof segment === "object" ? segment.key : segment),
        )
        .join(".");
      return `${path || fallback}: ${issue.message}`;
    })
    .join("; ");
}
