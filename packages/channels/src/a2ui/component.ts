import type { ComponentApi, ResolveA2uiProps } from "@a2ui/web_core/v0_9";
import type { z } from "zod";
import type {
  ChannelA2UIComponentImplementation,
  ChannelA2UIRenderer,
} from "./types.js";

export function defineChannelA2UIComponent<Schema extends z.ZodTypeAny>(
  api: ComponentApi<Schema>,
  renderer: ChannelA2UIRenderer<ResolveA2uiProps<z.infer<Schema>>>,
): ChannelA2UIComponentImplementation {
  return {
    name: api.name,
    schema: api.schema,
    lower(props, context) {
      return renderer({
        props: props as unknown as ResolveA2uiProps<z.infer<Schema>>,
        componentId: context.componentId,
        surfaceId: context.surfaceId,
        rawProps: context.rawProps,
        children: context.children,
        dispatch: context.dispatch,
      });
    },
  };
}
