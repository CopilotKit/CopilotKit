import { CopilotKitRemovedApiError, removedApiMessage } from "./errors";
import type { CopilotKitDocsSection, CopilotKitRemoval } from "./errors";

/**
 * The message of a `CopilotKitRemovedApiError`, as a type. When each part is
 * a string literal, it is the message itself. See `removedApiMessage`.
 */
export type RemovedApiMessage<
  What extends string,
  Use extends string,
  Docs extends CopilotKitDocsSection,
> = ReturnType<typeof removedApiMessage<What, Use, Docs>>;

// A key that only exists as a type, so that no value can satisfy `RemovedApi`.
declare const removedApiBrand: unique symbol;

/**
 * The type of a CopilotKit 1.x export that 2.0 removed. `Message` says what
 * to use instead. The type has no call or construct signature, so TypeScript
 * rejects each call, `new`, `extends`, and JSX use of the export, and its
 * error shows the message.
 */
export interface RemovedApi<Message extends string> {
  readonly [removedApiBrand]: Message;
}

/**
 * The stand-in for a type that CopilotKit 2.0 removed. Where 1.x code gives a
 * value this type, TypeScript fails with the message.
 *
 * @example
 * export type FrontendAction<_T = unknown> = RemovedType<
 *   "FrontendAction",
 *   "Use ReactFrontendTool from @copilotkit/react-core.",
 *   "/migrate/v2#hook-mapping"
 * >;
 */
export type RemovedType<
  Name extends string,
  Use extends string,
  Docs extends CopilotKitDocsSection,
> = RemovedApi<RemovedApiMessage<`"${Name}"`, Use, Docs>>;

/**
 * Creates the stand-in for a value that CopilotKit 2.0 removed: a hook, a
 * component, a class, or a function.
 *
 * The stand-in is a function. A call, `new`, or render of it throws a
 * `CopilotKitRemovedApiError`, so 1.x code fails where it uses the export and
 * not where it imports it. Its type is `RemovedApi`, so TypeScript fails on
 * the same code and prints the same message.
 *
 * Annotate the call as pure (`#__PURE__`), so that a bundler drops each
 * stand-in that the app does not use.
 *
 * @param removed - The name of the export, what to use instead, and the docs
 * section about the replacement.
 *
 * @example
 * export const useCopilotAction = removedApi({
 *   name: "useCopilotAction",
 *   use: "Use useFrontendTool from @copilotkit/react-core.",
 *   docs: "/migrate/v2#hook-mapping",
 * });
 */
export function removedApi<
  Name extends string,
  Use extends string,
  Docs extends CopilotKitDocsSection,
>({ name, use, docs }: { name: Name; use: Use; docs: Docs }) {
  // A function and not an arrow function: `new` runs it too, so a removed
  // class throws the same error when code constructs it.
  function removedExport(): never {
    throw new CopilotKitRemovedApiError({ what: `"${name}"`, use, docs });
  }
  // React's component stack and stack traces show this name.
  Object.defineProperty(removedExport, "name", { value: name });
  // At run time the stand-in is a function, so that a call or `new` reaches
  // the throw. Its type has no signature, so that TypeScript rejects the call
  // before it runs and prints the message. The two differ on purpose. The
  // type is spelled out, not `RemovedType`, so that the declaration files
  // hold the whole message and not the alias with its parts.
  const stub: unknown = removedExport;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- on purpose: the function must stay callable at run time, and its type must not be, see above
  return stub as RemovedApi<RemovedApiMessage<`"${Name}"`, Use, Docs>>;
}

/** The messages that `warnRemovedApiOnce` has written. */
const warnedRemovals = new Set<string>();

/** Whether the code runs in development, as bundlers set `NODE_ENV`. */
function isDevelopment() {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    // No `process`, and no bundler that replaced the expression: the code is
    // not in a development build, so it stays quiet.
    return false;
  }
}

/**
 * Warns once, in development, about 1.x code that CopilotKit 2.0 ignores.
 * The warning has the format of `removedApiMessage`. Each message warns once
 * per page or process.
 *
 * @param removal - What was removed, what to use instead, and the docs section.
 */
export function warnRemovedApiOnce(removal: CopilotKitRemoval) {
  if (!isDevelopment()) return;
  const message = removedApiMessage(removal);
  if (warnedRemovals.has(message)) return;
  warnedRemovals.add(message);
  console.warn(message);
}

/** A 1.x option, prop, or argument that CopilotKit 2.0 removed. */
export interface RemovedOption {
  /**
   * `"throw"` when the 1.x code cannot work in 2.0: it throws a
   * `CopilotKitRemovedApiError`. `"warn"` when 2.0 only ignores the option:
   * it warns once, in development.
   */
  effect: "throw" | "warn";
  /** What to do instead, as one or more full sentences. */
  use: string;
  /** The docs section about the replacement. */
  docs: CopilotKitDocsSection;
}

/**
 * Checks `options` for 1.x options that CopilotKit 2.0 removed. For each one
 * that is set, it throws a `CopilotKitRemovedApiError` or warns once in
 * development, as its entry in `removed` says. An option that is `undefined`
 * is not set.
 *
 * @param subject - What the options belong to, such as `prop of CopilotKit`.
 * The message starts with `The "threadId" prop of CopilotKit was removed in
 * CopilotKit 2.0.`
 * @param options - The options, props, or arguments that the code passed.
 * @param removed - The removed options, by name.
 *
 * @example
 * checkRemovedOptions("option of CopilotKitRuntime", options, {
 *   serviceAdapter: { effect: "throw", use: "...", docs: "/migrate/v2#update-the-runtime" },
 * });
 */
export function checkRemovedOptions(
  subject: string,
  options: object,
  removed: Record<string, RemovedOption>,
) {
  const entries = Object.entries(removed);
  for (const [name, { effect, use, docs }] of entries) {
    if (Reflect.get(options, name) === undefined) continue;
    const removal = { what: `The "${name}" ${subject}`, use, docs };
    if (effect === "throw") throw new CopilotKitRemovedApiError(removal);
    warnRemovedApiOnce(removal);
  }
}
