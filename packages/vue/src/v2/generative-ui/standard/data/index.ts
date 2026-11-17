import { chartComponent } from "./chart";
import { listComponents } from "./list";
import { mapComponent } from "./map";
import { tableComponents } from "./table";

export { CopilotGenerativeUIChart } from "./chart";
export { CopilotGenerativeUIList, CopilotGenerativeUIListItem } from "./list";
export { CopilotGenerativeUIMap } from "./map";
export {
  CopilotGenerativeUITable,
  CopilotGenerativeUITableCell,
  CopilotGenerativeUITableRow,
  CopilotGenerativeUITableSection,
} from "./table";

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
export const dataComponents = {
  ...tableComponents,
  ...listComponents,
  ...chartComponent,
  ...mapComponent,
};
