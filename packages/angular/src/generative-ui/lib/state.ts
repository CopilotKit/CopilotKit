import {
  DestroyRef,
  Injector,
  assertInInjectionContext,
  effect,
  inject,
  isDevMode,
  runInInjectionContext,
  untracked,
} from "@angular/core";
import type { Signal } from "@angular/core";
import { formatIssues, validateSchema } from "@copilotkit/shared/generative-ui";
import type {
  SchemaInput,
  ValidationResult,
} from "@copilotkit/shared/generative-ui";
import type {
  GenerativeUI,
  GenerativeUIDefinitionsOf,
  GenerativeUIFunctionArgs,
  GenerativeUIFunctionName,
  GenerativeUIStateOf,
} from "./catalog";
import { GENERATIVE_UI_RUNTIME } from "./runtime";

/** What `connectGenerativeUIState` takes for one key: the input of its schema. */
type StateInput<
  UI extends GenerativeUI<any>,
  Key extends keyof GenerativeUIStateOf<UI>,
> = SchemaInput<GenerativeUIDefinitionsOf<UI>["state"][Key]>;

export interface GenerativeUIInjectOptions {
  /** The injector to run in. Required outside of an injection context. */
  injector?: Injector;
}

function resolveInjector(
  options: GenerativeUIInjectOptions | undefined,
  caller: string,
) {
  if (options?.injector) return options.injector;
  assertInInjectionContext(caller as unknown as Function);
  return inject(Injector);
}

/**
 * Experimental. Gives one key of the app state declared in
 * `createGenerativeUI({ state })` its value. Bound props of generated
 * components read it. The model does not see it.
 *
 * The key is set now and whenever the value changes (compared as JSON). It
 * is removed when the injection context is destroyed.
 *
 * @param ui - The object from `createGenerativeUI`. It gives the key and the
 *   value their types.
 * @param key - A top-level key of `state`.
 * @param value - A signal or function with the value of that key. It must
 *   fit the key's schema.
 *
 * @example
 * ```ts
 * connectGenerativeUIState(storeUI, "cart", () => ({
 *   count: this.count(), total: this.total(), items: this.items(),
 * }));
 * ```
 */
export function connectGenerativeUIState<
  UI extends GenerativeUI<any>,
  Key extends keyof GenerativeUIStateOf<UI> & string,
>(
  ui: UI,
  key: Key,
  value: Signal<StateInput<UI, Key>> | (() => StateInput<UI, Key>),
  options?: GenerativeUIInjectOptions,
): void {
  // `ui` is for types only. The helper writes to the provider's generative
  // UI and does not check that `ui` is that object.
  void ui;
  const injector = resolveInjector(options, "connectGenerativeUIState");
  runInInjectionContext(injector, () => {
    const runtime = inject(GENERATIVE_UI_RUNTIME);
    const { manager } = runtime;
    let serialized: string | undefined;
    let generation = 0;
    effect(() => {
      const next = JSON.stringify(value());
      if (next === serialized) return;
      serialized = next;
      const current = ++generation;
      untracked(() => {
        const raw: unknown = JSON.parse(next ?? "null");
        const apply = (parsed: ValidationResult) => {
          if (current !== generation) return;
          if (parsed.success) {
            manager.setState(key, parsed.data);
            return;
          }
          // An invalid value is not stored. Bound props that read this key
          // show the props fallback.
          manager.removeState(key);
          if (isDevMode()) {
            console.error(
              `[generativeUI] connectGenerativeUIState: invalid value for "${key}": ${formatIssues(parsed.issues, "value")}`,
            );
          }
        };
        // Selectors get the parsed output, so schema defaults and transforms
        // run here. A schema that validates synchronously applies at once.
        const schema = runtime.ui.state.get(key);
        const parsed = schema
          ? validateSchema(schema, raw)
          : { success: true as const, data: raw };
        if (parsed instanceof Promise) void parsed.then(apply);
        else apply(parsed);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      generation++;
      manager.removeState(key);
    });
  });
}

/**
 * Experimental. Mounts the handler of a function declared in
 * `createGenerativeUI({ functions })`. Generated UI can call the function
 * only while exactly one handler for it is mounted.
 *
 * The handler gets the parsed arguments: schema defaults are set. It is
 * unmounted when the injection context is destroyed.
 *
 * @param ui - The object from `createGenerativeUI`. It gives the name and the
 *   handler arguments their types.
 * @param name - A key of `functions`.
 * @param handler - Runs when generated UI calls the function. Its return
 *   value goes back to the caller as `{ ok: true, result }`.
 *
 * @example
 * ```ts
 * registerGenerativeUIFunction(storeUI, "addToCart", ({ productId, quantity }) =>
 *   this.cart.addItem(productId, quantity),
 * );
 * ```
 */
export function registerGenerativeUIFunction<
  UI extends GenerativeUI<any>,
  Name extends GenerativeUIFunctionName<UI>,
>(
  ui: UI,
  name: Name,
  handler: (args: GenerativeUIFunctionArgs<UI, Name>) => unknown,
  options?: GenerativeUIInjectOptions,
): void {
  // `ui` is for types only. The helper registers with the provider's
  // generative UI and does not check that `ui` is that object.
  void ui;
  const injector = resolveInjector(options, "registerGenerativeUIFunction");
  runInInjectionContext(injector, () => {
    const runtime = inject(GENERATIVE_UI_RUNTIME);
    const unregister = runtime.dispatcher.register(name, {
      current: handler as (args: unknown) => unknown,
    });
    inject(DestroyRef).onDestroy(unregister);
  });
}
