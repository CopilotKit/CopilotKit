import { useEffect, useRef, useSyncExternalStore } from "react";
import type {
  GenerativeUI,
  GenerativeUIDefinitionsOf,
  GenerativeUIFunctionArgs,
  GenerativeUIFunctionName,
  GenerativeUIStateOf,
} from "./catalog";
import { useRequiredGenerativeUIRuntime } from "./runtime-context";
import type { GenerativeUIRuntime } from "./runtime-context";
import { formatIssues, validateSchema } from "./schema";
import type { SchemaInput, ValidationResult } from "./schema";

const noopSubscribe = () => () => {};
const zero = () => 0;

/** Re-renders on any surface-manager change. */
export function useManagerVersion(runtime: GenerativeUIRuntime | null): number {
  return useSyncExternalStore(
    runtime?.manager.subscribe ?? noopSubscribe,
    runtime?.manager.getVersion ?? zero,
    zero,
  );
}

/** What `useGenerativeUIState` takes for one key: the input of its schema. */
type StateInput<
  UI extends GenerativeUI<any>,
  Key extends keyof GenerativeUIStateOf<UI>,
> = SchemaInput<GenerativeUIDefinitionsOf<UI>["state"][Key]>;

/**
 * Experimental. Gives one key of the app state declared in
 * `createGenerativeUI({ state })` its value. Bound props of generated
 * components read it. The model does not see it.
 *
 * The key is set on mount and when the value changes (compared as JSON). It
 * is removed on unmount.
 *
 * @param ui - The object from `createGenerativeUI`. It gives the key and the
 *   value their types.
 * @param key - A top-level key of `state`.
 * @param value - The value of that key. It must fit the key's schema.
 *
 * @example
 * ```tsx
 * useGenerativeUIState(storeUI, "cart", { count, total, coupon, items });
 * ```
 */
export function useGenerativeUIState<
  UI extends GenerativeUI<any>,
  Key extends keyof GenerativeUIStateOf<UI> & string,
>(ui: UI, key: Key, value: StateInput<UI, Key>) {
  // ponytail: `ui` is for types only. The hook writes to the provider's generative UI and does not check that `ui` is that object.
  const runtime = useRequiredGenerativeUIRuntime();
  const serialized = JSON.stringify(value);
  useEffect(() => {
    const raw: unknown = JSON.parse(serialized ?? "null");
    let current = true;
    const apply = (parsed: ValidationResult) => {
      if (!current) return;
      if (parsed.success) {
        runtime.manager.setState(key, parsed.data);
        return;
      }
      // An invalid value is not stored. Bound props that read this key show the props fallback.
      runtime.manager.removeState(key);
      if (process.env.NODE_ENV !== "production") {
        console.error(
          `[generativeUI] useGenerativeUIState: invalid value for "${key}": ${formatIssues(parsed.issues, "value")}`,
        );
      }
    };
    // Selectors get the parsed output, so schema defaults and transforms run
    // here. A schema that validates synchronously applies at once.
    const schema = runtime.ui.state.get(key);
    const parsed = schema
      ? validateSchema(schema, raw)
      : { success: true as const, data: raw };
    if (parsed instanceof Promise) void parsed.then(apply);
    else apply(parsed);
    return () => {
      current = false;
    };
  }, [runtime, key, serialized]);
  useEffect(() => () => runtime.manager.removeState(key), [runtime, key]);
}

/**
 * Experimental. Mounts the handler of a function declared in
 * `createGenerativeUI({ functions })`. Generated UI can call the function
 * only while exactly one handler for it is mounted.
 *
 * The handler gets the parsed arguments: schema defaults are set. It can
 * change on each render. The latest handler always runs, and the hook does
 * not register again.
 *
 * @param ui - The object from `createGenerativeUI`. It gives the name and the
 *   handler arguments their types.
 * @param name - A key of `functions`.
 * @param handler - Runs when generated UI calls the function. Its return
 *   value goes back to the caller as `{ ok: true, result }`.
 *
 * @example
 * ```tsx
 * useGenerativeUIFunction(storeUI, "addToCart", ({ productId, quantity }) =>
 *   cart.addItem(productId, quantity),
 * );
 * ```
 */
export function useGenerativeUIFunction<
  UI extends GenerativeUI<any>,
  Name extends GenerativeUIFunctionName<UI>,
>(
  ui: UI,
  name: Name,
  handler: (args: GenerativeUIFunctionArgs<UI, Name>) => unknown,
) {
  // ponytail: `ui` is for types only. The hook registers with the provider's generative UI and does not check that `ui` is that object.
  const runtime = useRequiredGenerativeUIRuntime();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => runtime.dispatcher.register(name, latest), [runtime, name]);
}
