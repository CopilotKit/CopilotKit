import React, { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { GENERATIVE_UI_MAX_TARGET_COMPONENTS } from "@copilotkit/shared";
import type { GenerativeUI, GenerativeUIComponentName } from "./catalog";
import { useManagerVersion } from "./hooks";
import { useRequiredGenerativeUIRuntime } from "./runtime-context";
import { SurfaceView } from "./SurfaceView";

export interface GenerativeUISurfaceProps<
  UI extends GenerativeUI<any> = GenerativeUI<any>,
> {
  /** Target id the agent renders into. */
  id: string;
  /**
   * Tells the model where this surface is and what to show in it, for
   * example "Next to the product list. Use it for product recommendations."
   */
  description?: string;
  /**
   * The only components that the agent can use in this surface, the root
   * included. The agent gets the list, and an operation with another
   * component is rejected. Left out, every component of the UI is allowed.
   *
   * Give the type of the UI to check the names:
   * `<GenerativeUISurface<typeof storeUI> components={["Row"]} />`.
   * Without it, a name that is not in the UI is ignored, with a warning in
   * development.
   */
  components?: readonly GenerativeUIComponentName<UI>[];
  /** Shown until a surface targets this id. */
  fallback?: ReactNode;
  className?: string;
}

const isDevelopment = () => process.env.NODE_ENV !== "production";

/**
 * The names of `requested` that `ui` has, without repeats, at most the
 * number that the envelope takes. `warning` tells what was dropped.
 */
function allowedComponents(requested: readonly string[], ui: GenerativeUI) {
  const unique = [...new Set(requested)];
  const unknown = unique.filter((name) => !ui.components.has(name));
  const known = unique.filter((name) => ui.components.has(name));
  const names = known.slice(0, GENERATIVE_UI_MAX_TARGET_COMPONENTS);
  const problems: string[] = [];
  if (unknown.length > 0) {
    problems.push(
      `these components are not in the UI and are ignored: ${unknown.join(", ")}`,
    );
  }
  if (known.length > names.length) {
    problems.push(
      `only the first ${GENERATIVE_UI_MAX_TARGET_COMPONENTS} components are used`,
    );
  }
  return { names, warning: problems.join("; ") };
}

/**
 * Experimental. A named place on the page where the agent can render UI.
 *
 * @example
 * ```tsx
 * <GenerativeUISurface<typeof storeUI>
 *   id="products"
 *   description="The product list. Show the products that the user asks for."
 *   components={["ProductRow", "ProductCard"]}
 *   fallback={<FeaturedProducts />}
 * />
 * ```
 */
export function GenerativeUISurface<
  UI extends GenerativeUI<any> = GenerativeUI<any>,
>({
  id,
  description,
  components,
  fallback = null,
  className,
}: GenerativeUISurfaceProps<UI>) {
  const runtime = useRequiredGenerativeUIRuntime();
  useManagerVersion(runtime);
  // A new array with the same names must not register the target again.
  const componentsKey =
    components === undefined ? undefined : JSON.stringify(components);
  const warnedKey = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const requested: string[] | undefined =
      componentsKey === undefined ? undefined : JSON.parse(componentsKey);
    const allowed = requested && allowedComponents(requested, runtime.ui);
    const shouldWarn =
      allowed !== undefined &&
      allowed.warning !== "" &&
      warnedKey.current !== componentsKey &&
      isDevelopment();
    if (shouldWarn) {
      warnedKey.current = componentsKey;
      console.warn(
        `[generativeUI] <GenerativeUISurface id="${id}">: ${allowed.warning}.`,
      );
    }
    return runtime.manager.registerTarget(id, {
      description,
      components: allowed?.names,
    });
  }, [runtime, id, description, componentsKey]);
  const surface = runtime.manager.getSurfaceForTarget(id);
  if (!surface) return <>{fallback}</>;
  return (
    <div data-generative-ui-surface={id} className={className}>
      <SurfaceView surface={surface} />
    </div>
  );
}
