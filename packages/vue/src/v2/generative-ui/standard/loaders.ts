import { inject, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import type { InjectionKey } from "vue";

/**
 * Loads an optional library for a standard component. The
 * `@copilotkit/vue/v2/generative-ui/chart` and `/map` plugins provide the
 * loaders, so the libraries stay out of apps that do not use them. Without
 * a loader, the component shows its fallback.
 */
export type GenerativeUILibraryLoader = () => Promise<unknown>;

/**
 * The load state of an optional library:
 *
 * - `"none"`: the app provided no loader. The component shows its fallback.
 * - `"loading"`: the loader runs. This is also the state on the server, so
 *   the server HTML and the first client render match.
 * - `"ready"`: the library is loaded.
 * - `"failed"`: the loader rejected. The component shows its fallback.
 */
export type GenerativeUILibraryStatus = "none" | "loading" | "ready" | "failed";

/**
 * Loads `chart.js/auto`. The `/chart` plugin provides it. Without it, Chart
 * renders its data as a table.
 */
export const GENERATIVE_UI_CHART_LOADER: InjectionKey<GenerativeUILibraryLoader> =
  Symbol("GENERATIVE_UI_CHART_LOADER");

/**
 * Loads `maplibre-gl`. The `/map` plugin provides it. Without it, Map
 * renders its markers as a list.
 */
export const GENERATIVE_UI_MAP_LOADER: InjectionKey<GenerativeUILibraryLoader> =
  Symbol("GENERATIVE_UI_MAP_LOADER");

/** One import per loader, so many charts on a page share it. */
const loads = new WeakMap<GenerativeUILibraryLoader, Promise<unknown>>();

function load(loader: GenerativeUILibraryLoader) {
  const pending = loads.get(loader);
  if (pending) return pending;
  // The executor catches a loader that throws before it returns a promise.
  const promise = new Promise<unknown>((resolve) => resolve(loader()));
  loads.set(loader, promise);
  // A failed import is not kept, so a component mounted later tries again.
  promise.catch(() => loads.delete(loader));
  return promise;
}

/**
 * Loads the optional library of `key` in the browser, once per loader.
 * Call it in the `setup` of a standard component.
 *
 * @param key - `GENERATIVE_UI_CHART_LOADER` or `GENERATIVE_UI_MAP_LOADER`.
 * @returns `library`, the loaded module (`null` until it is ready), and
 *   `status` (see `GenerativeUILibraryStatus`).
 *
 * @example
 * ```ts
 * const { library, status } = useGenerativeUILibrary(GENERATIVE_UI_CHART_LOADER);
 * // Show the data table while status.value is not "ready".
 * ```
 */
export function useGenerativeUILibrary(
  key: InjectionKey<GenerativeUILibraryLoader>,
) {
  const loader = inject(key, null);
  const library = shallowRef<unknown>(null);
  const status = ref<GenerativeUILibraryStatus>(loader ? "loading" : "none");
  if (!loader) return { library, status };
  let isActive = true;
  // `onMounted` runs only in the browser, never during server rendering.
  onMounted(() => {
    load(loader).then(
      (module) => {
        if (!isActive) return;
        library.value = module;
        status.value = "ready";
      },
      () => {
        if (isActive) status.value = "failed";
      },
    );
  });
  onBeforeUnmount(() => (isActive = false));
  return { library, status };
}
