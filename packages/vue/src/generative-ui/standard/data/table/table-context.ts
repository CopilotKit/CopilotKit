import { computed, inject, provide } from "vue";
import type { InjectionKey, Ref } from "vue";

/** What a Table, TableSection or TableRow tells the rows and cells in it. */
export interface GenerativeUITableContext {
  /** Whether the rows have hairline dividers. */
  dividers: boolean;
  /** True inside a TableSection or a TableRow. Rows there render a bare `<tr>`. */
  isInSection: boolean;
  /** True inside a header section or row. Cells there render `<th>`. */
  isHeader: boolean;
}

const GENERATIVE_UI_TABLE_CONTEXT: InjectionKey<
  Readonly<Ref<GenerativeUITableContext>>
> = Symbol("GENERATIVE_UI_TABLE_CONTEXT");

/** The context of the nearest Table, TableSection or TableRow, or `null` outside a Table. */
export function useTableContext() {
  return inject(GENERATIVE_UI_TABLE_CONTEXT, null);
}

/**
 * Gives the rows and cells below the component its table context. Call it
 * in the `setup` of Table, TableSection and TableRow.
 *
 * @param context - A getter of the context, read again when its props change.
 */
export function provideTableContext(context: () => GenerativeUITableContext) {
  provide(GENERATIVE_UI_TABLE_CONTEXT, computed(context));
}
