import {
  dataDeclarations,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import { CopilotGenerativeUIChart } from "./chart";
import { CopilotGenerativeUIList } from "./list";
import { CopilotGenerativeUIListItem } from "./list-item";
import { CopilotGenerativeUIMap } from "./map";
import {
  CopilotGenerativeUITable,
  CopilotGenerativeUITableCell,
  CopilotGenerativeUITableRow,
  CopilotGenerativeUITableSection,
} from "./table";

export { CopilotGenerativeUIChart, chartConfig } from "./chart";
export { CopilotGenerativeUIList } from "./list";
export {
  CopilotGenerativeUIListItem,
  GENERATIVE_UI_LIST_CONTEXT,
} from "./list-item";
export type { GenerativeUIListContext } from "./list-item";
export {
  CopilotGenerativeUIMap,
  guardNumericFilter,
  guardStyleFilters,
} from "./map";
export {
  CopilotGenerativeUITable,
  CopilotGenerativeUITableCell,
  CopilotGenerativeUITableRow,
  CopilotGenerativeUITableSection,
  GENERATIVE_UI_TABLE_CONTEXT,
} from "./table";
export type { GenerativeUITableContext } from "./table";

/**
 * The standard data components: tables, lists, a chart and a map. Give
 * them to `createGenerativeUI({ components: { ...dataComponents } })`.
 *
 * - Table: `children` (TableSection or TableRow ids, or a template) and
 *   `cellComponents` (the components that `{ componentId }` cells show).
 * - List and ListItem: an `action` event. The List event gets the index,
 *   label and value of the picked item.
 * - Map: `selected` is writable, so a `{ "@path" }` binding gets the choice of
 *   the user.
 */
export const dataComponents = withComponents(dataDeclarations, {
  Table: CopilotGenerativeUITable,
  TableSection: CopilotGenerativeUITableSection,
  TableRow: CopilotGenerativeUITableRow,
  TableCell: CopilotGenerativeUITableCell,
  List: CopilotGenerativeUIList,
  ListItem: CopilotGenerativeUIListItem,
  Chart: CopilotGenerativeUIChart,
  Map: CopilotGenerativeUIMap,
});
