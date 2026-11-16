import {
  dataDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import CopilotGenerativeUITable from "./Table.vue";
import CopilotGenerativeUITableCell from "./TableCell.vue";
import CopilotGenerativeUITableRow from "./TableRow.vue";
import CopilotGenerativeUITableSection from "./TableSection.vue";

export {
  CopilotGenerativeUITable,
  CopilotGenerativeUITableCell,
  CopilotGenerativeUITableRow,
  CopilotGenerativeUITableSection,
};

/**
 * The standard table components: their declarations from the shared
 * catalog, with the Vue components. The data group spreads them into its
 * components.
 *
 * - Table: `children` (TableSection or TableRow ids, or a template) and
 *   `cellComponents` (the components that `{ componentId }` cells show).
 * - TableSection, TableRow and TableCell apply their accessibility envelope
 *   themselves: a table part cannot sit in a wrapper element.
 *
 * @example
 * ```ts
 * const ui = createGenerativeUI({ components: { ...tableComponents } });
 * ```
 */
export const tableComponents = withComponents(
  {
    Table: dataDeclarations.Table,
    TableSection: dataDeclarations.TableSection,
    TableRow: dataDeclarations.TableRow,
    TableCell: dataDeclarations.TableCell,
  },
  {
    Table: CopilotGenerativeUITable,
    TableSection: CopilotGenerativeUITableSection,
    TableRow: CopilotGenerativeUITableRow,
    TableCell: CopilotGenerativeUITableCell,
  },
);
