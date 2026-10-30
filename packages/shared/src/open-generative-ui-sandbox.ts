import type { StandardSchemaV1 } from "./standard-schema";

interface SandboxFunctionBinding {
  name: string;
  parameters: StandardSchemaV1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => unknown;
}

/**
 * Builds the websandbox `localApi` for an Open Generative UI frame.
 *
 * Generated code chooses the arguments, so each call is checked against the
 * function's `parameters` before its handler runs. The handler receives the
 * parsed value. A call with no argument is validated as `undefined`, then as
 * `{}`, so zero-argument functions work with `z.void()` or `z.object({})`.
 *
 * An invalid call rejects inside the frame and warns on the host. websandbox
 * flattens an `Error` to a plain `{ message }` on the way into the frame, so
 * generated code should read `error.message`, not rely on `instanceof Error`.
 */
export function createSandboxLocalApi(
  functions: readonly SandboxFunctionBinding[],
): Record<string, (args?: unknown) => Promise<unknown>> {
  const api: Record<string, (args?: unknown) => Promise<unknown>> =
    Object.create(null);
  for (const fn of functions) {
    const validate = (value: unknown) =>
      fn.parameters["~standard"].validate(value);
    api[fn.name] = async (args) => {
      let result = await validate(args);
      if (result.issues && args === undefined) result = await validate({});
      if (result.issues) {
        const details = result.issues.map((issue) => issue.message).join("; ");
        const message = `Invalid arguments for sandbox function "${fn.name}": ${details}`;
        console.warn(`[OpenGenerativeUI] ${message}`);
        throw new Error(message);
      }
      return fn.handler(result.value);
    };
  }
  return api;
}
