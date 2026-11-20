import { shallowRef, toValue, watch } from "vue";
import type { MaybeRefOrGetter } from "vue";
import { formatIssues, validateSchema } from "@copilotkit/shared/generative-ui";
import type {
  AnyGenerativeUI,
  SchemaInput,
  ValidationResult,
} from "@copilotkit/shared/generative-ui";
import type {
  GenerativeUIDefinitionsOf,
  GenerativeUIFunctionArgs,
  GenerativeUIFunctionName,
  GenerativeUIStateOf,
} from "./catalog";
import { useRequiredGenerativeUIRuntime } from "./runtime-context";
import type { GenerativeUIRuntime } from "./runtime-context";

/**
 * A ref that counts the changes of the surface manager. Read it in a
 * computed or a render to run again on any manager change. It follows the
 * manager of the latest runtime, and stops listening when the effect scope
 * is disposed.
 *
 * @param runtime - The runtime ref from `useGenerativeUIRuntime`. While its
 *   value is `null`, the version is 0.
 */
export function useManagerVersion(
  runtime: MaybeRefOrGetter<GenerativeUIRuntime | null>,
) {
  const version = shallowRef(0);
  watch(
    () => toValue(runtime)?.manager,
    (manager, _previous, onCleanup) => {
      if (!manager) {
        version.value = 0;
        return;
      }
      version.value = manager.getVersion();
      onCleanup(
        manager.subscribe(() => {
          version.value = manager.getVersion();
        }),
      );
    },
    { immediate: true },
  );
  return version;
}

/** What `useGenerativeUIState` takes for one key: the input of its schema. */
type StateInput<
  UI extends AnyGenerativeUI,
  Key extends keyof GenerativeUIStateOf<UI>,
> = SchemaInput<GenerativeUIDefinitionsOf<UI>["state"][Key]>;

/**
 * Experimental. Gives one key of the app state declared in
 * `createGenerativeUI({ state })` its value. Bound props of generated
 * components read it. The model does not see it.
 *
 * The key is set at once and when the value changes (compared as JSON). It
 * is removed when the effect scope is disposed, for example when the
 * component unmounts.
 *
 * @param ui - The object from `createGenerativeUI`. It gives the key and the
 *   value their types.
 * @param key - A top-level key of `state`.
 * @param value - The value of that key, as a plain value, a ref, or a getter.
 *   It must fit the key's schema.
 * @throws Error when it is called outside a provider with a `generativeUI`
 *   config.
 *
 * @example
 * ```ts
 * useGenerativeUIState(storeUI, "cart", () => ({
 *   count: cart.count,
 *   total: cart.total,
 *   items: cart.items,
 * }));
 * ```
 */
export function useGenerativeUIState<
  UI extends AnyGenerativeUI,
  Key extends keyof GenerativeUIStateOf<UI> & string,
>(ui: UI, key: Key, value: MaybeRefOrGetter<StateInput<UI, Key>>) {
  // ponytail: `ui` is for types only. The composable writes to the provider's generative UI and does not check that `ui` is that object.
  const runtime = useRequiredGenerativeUIRuntime();
  watch(
    [() => runtime.value.manager, () => JSON.stringify(toValue(value))],
    ([manager, serialized], _previous, onCleanup) => {
      const raw: unknown = JSON.parse(serialized ?? "null");
      let current = true;
      onCleanup(() => {
        current = false;
      });
      const apply = (parsed: ValidationResult) => {
        if (!current) return;
        if (parsed.success) {
          manager.setState(key, parsed.data);
          return;
        }
        // An invalid value is not stored. Bound props that read this key show the props fallback.
        manager.removeState(key);
        if (process.env.NODE_ENV !== "production") {
          console.error(
            `[generativeUI] useGenerativeUIState: invalid value for "${key}": ${formatIssues(parsed.issues, "value")}`,
          );
        }
      };
      // Selectors get the parsed output, so schema defaults and transforms
      // run here. A schema that validates synchronously applies at once.
      const schema = runtime.value.ui.state.get(key);
      const parsed = schema
        ? validateSchema(schema, raw)
        : { success: true as const, data: raw };
      if (parsed instanceof Promise) void parsed.then(apply);
      else apply(parsed);
    },
    { immediate: true },
  );
  watch(
    () => runtime.value.manager,
    (manager, _previous, onCleanup) => {
      onCleanup(() => manager.removeState(key));
    },
    { immediate: true },
  );
}

/**
 * Experimental. Mounts the handler of a function declared in
 * `createGenerativeUI({ functions })`. Generated UI can call the function
 * only while exactly one handler for it is mounted.
 *
 * The handler gets the parsed arguments: schema defaults are set. It reads
 * refs and props when it runs, so it always sees the latest values. The
 * handler is registered once, and unregistered when the effect scope is
 * disposed.
 *
 * @param ui - The object from `createGenerativeUI`. It gives the name and the
 *   handler arguments their types.
 * @param name - A key of `functions`.
 * @param handler - Runs when generated UI calls the function. Its return
 *   value goes back to the caller as `{ ok: true, result }`.
 * @throws Error when it is called outside a provider with a `generativeUI`
 *   config.
 *
 * @example
 * ```ts
 * useGenerativeUIFunction(storeUI, "addToCart", ({ productId, quantity }) =>
 *   cart.addItem(productId, quantity),
 * );
 * ```
 */
export function useGenerativeUIFunction<
  UI extends AnyGenerativeUI,
  Name extends GenerativeUIFunctionName<UI>,
>(
  ui: UI,
  name: Name,
  handler: (args: GenerativeUIFunctionArgs<UI, Name>) => unknown,
) {
  // ponytail: `ui` is for types only. The composable registers with the provider's generative UI and does not check that `ui` is that object.
  const runtime = useRequiredGenerativeUIRuntime();
  // One handler ref for the whole scope: a new runtime object (a new theme)
  // with the same dispatcher does not register again.
  const latest = { current: handler };
  watch(
    () => runtime.value.dispatcher,
    (dispatcher, _previous, onCleanup) => {
      onCleanup(dispatcher.register(name, latest));
    },
    { immediate: true },
  );
}
