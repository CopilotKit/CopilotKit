import { computed, inject, provide } from "vue";
import type { InjectionKey, Ref } from "vue";
import type { ListMarker } from "@copilotkit/shared/generative-ui";

/** What a List tells the ListItem children in it. */
export interface GenerativeUIListContext {
  marker: ListMarker;
  /** Whether a vertical line joins the items. */
  hasConnector: boolean;
  /** The width of the marker column in pixels. */
  maxMarkerSize: number | undefined;
}

const GENERATIVE_UI_LIST_CONTEXT: InjectionKey<
  Readonly<Ref<GenerativeUIListContext>>
> = Symbol("GENERATIVE_UI_LIST_CONTEXT");

/** The context of the nearest List, or `null` outside a List. */
export function useListContext() {
  return inject(GENERATIVE_UI_LIST_CONTEXT, null);
}

/**
 * Gives the ListItem children of a List its context. Call it in the `setup`
 * of List.
 *
 * @param context - A getter of the context, read again when its props change.
 */
export function provideListContext(context: () => GenerativeUIListContext) {
  provide(GENERATIVE_UI_LIST_CONTEXT, computed(context));
}

/** True for the markers the browser draws: a bullet or a number. */
export const isNativeMarker = (marker: string | undefined) =>
  marker === "bullet" || marker === "number";
