import type {
  ComponentApi,
  InferredComponentApiSchemaType,
  ResolveA2uiProps,
} from "@a2ui/web_core/v0_9";

/** Binder-resolved props of a basic catalog component. */
export type BasicProps<Api extends ComponentApi> = ResolveA2uiProps<
  InferredComponentApiSchemaType<Api>
>;

export { mapAlign, mapJustify } from "@copilotkit/a2ui-renderer/engine";

let idCounter = 0;

/** A document-unique id for pairing labels with inputs. */
export function uniqueId(prefix: string): string {
  idCounter += 1;
  return `copilot-a2ui-${prefix}-${idCounter}`;
}
