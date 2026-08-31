import type { TemplateResult } from "lit";
import type {
  ComponentApi,
  InferredComponentApiSchemaType,
  ResolveA2uiProps,
} from "@a2ui/web_core/v0_9";
import type { ComponentContext, SurfaceModel } from "@a2ui/web_core/v0_9";
import type { z, ZodObject, ZodRawShape } from "zod";

export type LitRenderable =
  | TemplateResult
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | LitRenderable[];

export interface LitComponentImplementation extends ComponentApi {
  render: (
    context: ComponentContext,
    buildChild: (id: string, basePath?: string) => LitRenderable,
  ) => LitRenderable;
}

export interface LitA2UIComponentProps<T, S = void> {
  props: T;
  buildChild: (id: string, basePath?: string) => LitRenderable;
  context: ComponentContext;
  state: S;
  requestUpdate: () => void;
}

export type LitRendererFn<Api extends ComponentApi, S = void> = (
  componentProps: LitA2UIComponentProps<
    ResolveA2uiProps<InferredComponentApiSchemaType<Api>>,
    S
  >,
) => LitRenderable;

export interface RendererProps<T = Record<string, unknown>> {
  props: T;
  children: (id: string, basePath?: string) => LitRenderable;
  dispatch?: (action: unknown) => void;
}

export type ComponentRenderer<T = Record<string, unknown>> = (
  props: RendererProps<T>,
) => LitRenderable;

export interface CatalogComponentDefinition<
  T extends ZodRawShape = ZodRawShape,
> {
  props: ZodObject<T>;
  description?: string;
}

export type CatalogDefinitions = Record<
  string,
  CatalogComponentDefinition<any>
>;

export type PropsOf<D extends CatalogDefinitions, K extends keyof D> = z.infer<
  D[K]["props"]
>;

export type CatalogRenderers<D extends CatalogDefinitions> = {
  [K in keyof D]: ComponentRenderer<z.infer<D[K]["props"]>>;
};

export interface A2UISurfaceElement extends HTMLElement {
  operations: unknown[];
  catalog?: unknown;
  theme?: Record<string, unknown>;
  surfaceId?: string;
  loadingComponent?: unknown;
}

export interface A2UINodeElement extends HTMLElement {
  surface?: SurfaceModel<LitComponentImplementation>;
  componentId?: string;
  basePath?: string;
}
