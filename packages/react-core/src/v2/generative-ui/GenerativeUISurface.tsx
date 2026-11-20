import React, { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import {
  allowedComponents,
  scrollToSurface,
} from "@copilotkit/core/generative-ui";
import type { GenerativeUI, GenerativeUIComponentName } from "./catalog";
import { useManagerVersion } from "./hooks";
import { useRequiredGenerativeUIRuntime } from "./runtime-context";
import { SurfaceView } from "./SurfaceView";

interface GenerativeUISurfaceBaseProps {
  /** Target id the agent renders into. */
  id: string;
  /**
   * Tells the model where this surface is and what to show in it, for
   * example "Next to the product list. Use it for product recommendations."
   */
  description?: string;
  /** Shown until a surface targets this id. */
  fallback?: ReactNode;
  className?: string;
  /**
   * Scrolls the page to this surface when the agent starts to render into
   * it, unless the surface is already on screen. Defaults to `true`. With a
   * sticky header, give the surface a `scroll-margin-top`
   * (`[data-generative-ui-surface] { scroll-margin-top: 5rem }`).
   */
  autoScroll?: boolean;
}

/**
 * Props of {@link GenerativeUISurface}. `components` takes `ui`, which
 * types the component names.
 */
export type GenerativeUISurfaceProps<
  UI extends GenerativeUI<any> = GenerativeUI<any>,
> = GenerativeUISurfaceBaseProps &
  (
    | {
        /**
         * The UI of the provider (`generativeUI.ui`). It types the names in
         * `components`.
         */
        ui: UI;
        /**
         * The only components that the agent can use in this surface, the
         * root included. The agent gets the list, and an operation with
         * another component is rejected. Left out, every component of the UI
         * is allowed.
         */
        components?: readonly GenerativeUIComponentName<UI>[];
      }
    | { ui?: undefined; components?: undefined }
  );

const isDevelopment = () => process.env.NODE_ENV !== "production";

/**
 * Experimental. A named place on the page where the agent can render UI.
 *
 * @example
 * ```tsx
 * <GenerativeUISurface
 *   id="products"
 *   ui={storeUI}
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
  ui,
  components,
  fallback = null,
  className,
  autoScroll = true,
}: GenerativeUISurfaceProps<UI>) {
  const runtime = useRequiredGenerativeUIRuntime();
  useManagerVersion(runtime);
  // The agent renders only the components of the provider's UI, so the
  // names are checked against it. A different `ui` is a setup mistake.
  const otherUI = ui !== undefined && ui !== runtime.ui;
  useLayoutEffect(() => {
    if (otherUI && isDevelopment()) {
      console.warn(
        `[generativeUI] <GenerativeUISurface id="${id}">: the ui prop is not the UI of the provider (generativeUI.ui). The components are checked against the UI of the provider.`,
      );
    }
  }, [otherUI, id]);
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
  // Every render_ui call (and every streaming markdown fence) sets the
  // status to "streaming", for a new surface and for an update. The key is
  // set only while the surface streams, so each start runs the effect once.
  const generatingKey =
    surface?.status === "streaming" ? surface.key : undefined;
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoScroll && generatingKey && element.current) {
      scrollToSurface(element.current);
    }
  }, [autoScroll, generatingKey]);
  if (!surface) return <>{fallback}</>;
  return (
    <div ref={element} data-generative-ui-surface={id} className={className}>
      <SurfaceView surface={surface} />
    </div>
  );
}
