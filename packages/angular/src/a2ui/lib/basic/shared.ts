import type {
  ComponentApi,
  InferredComponentApiSchemaType,
  ResolveA2uiProps,
} from "@a2ui/web_core/v0_9";

/** Binder-resolved props of a basic catalog component. */
export type BasicProps<Api extends ComponentApi> = ResolveA2uiProps<
  InferredComponentApiSchemaType<Api>
>;

export function mapJustify(justify?: string): string {
  switch (justify) {
    case "center":
      return "center";
    case "end":
      return "flex-end";
    case "spaceAround":
      return "space-around";
    case "spaceBetween":
      return "space-between";
    case "spaceEvenly":
      return "space-evenly";
    case "stretch":
      return "stretch";
    default:
      return "flex-start";
  }
}

export function mapAlign(align?: string): string {
  switch (align) {
    case "start":
      return "flex-start";
    case "center":
      return "center";
    case "end":
      return "flex-end";
    default:
      return "stretch";
  }
}

let idCounter = 0;

/** A document-unique id for pairing labels with inputs. */
export function uniqueId(prefix: string): string {
  idCounter += 1;
  return `copilot-a2ui-${prefix}-${idCounter}`;
}
