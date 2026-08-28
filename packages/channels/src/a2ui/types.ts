import type {
  A2uiClientAction,
  Catalog,
  ComponentApi,
  ResolveA2uiProps,
} from "@a2ui/web_core/v0_9";
import type { InteractionContext, Renderable } from "@copilotkit/channels-core";
import type { z, ZodObject, ZodRawShape } from "zod";

export interface ChannelA2UICatalogSchema {
  readonly catalogId: string;
  readonly components: Readonly<Record<string, Record<string, unknown>>>;
}

export interface ChannelA2UIActionContext {
  readonly action: A2uiClientAction;
  readonly interaction: InteractionContext;
}

export type ChannelA2UIActionHandler = (
  context: ChannelA2UIActionContext,
) => void | Promise<void>;

export interface ChannelA2UIComponentDefinition<
  Shape extends ZodRawShape = ZodRawShape,
> {
  readonly props: ZodObject<Shape>;
  readonly description?: string;
}

export type ChannelA2UICatalogDefinitions = Record<
  string,
  ChannelA2UIComponentDefinition<any>
>;

export interface ChannelA2UIRendererProps<Props> {
  readonly props: Props;
  readonly componentId: string;
  readonly surfaceId: string;
  readonly rawProps: Readonly<Record<string, unknown>>;
  children(id: string, basePath?: string): Renderable;
  dispatch(action: unknown, interaction?: InteractionContext): Promise<void>;
}

export type ChannelA2UIRenderer<Props> = (
  input: ChannelA2UIRendererProps<Props>,
) => Renderable;

export type ChannelA2UICatalogRenderers<
  Definitions extends ChannelA2UICatalogDefinitions,
> = {
  [Name in keyof Definitions]: ChannelA2UIRenderer<
    ResolveA2uiProps<z.infer<Definitions[Name]["props"]>>
  >;
};

export interface ChannelA2UILoweringContext {
  readonly componentId: string;
  readonly surfaceId: string;
  readonly rawProps: Readonly<Record<string, unknown>>;
  children(id: string, basePath?: string): Renderable;
  dispatch(action: unknown, interaction?: InteractionContext): Promise<void>;
}

export interface ChannelA2UIComponentImplementation extends ComponentApi {
  lower(
    props: Record<string, unknown>,
    context: ChannelA2UILoweringContext,
  ): Renderable;
}

export interface ChannelA2UICatalog {
  readonly id: string;
  readonly processorCatalog: Catalog<ChannelA2UIComponentImplementation>;
  readonly schema: ChannelA2UICatalogSchema;
}
