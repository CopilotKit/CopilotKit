import { definitions, type ComponentName } from "@/a2ui/catalog/definitions";
import type { Category } from "@/a2ui/catalog/definitions/shared";

/** Category order used by the sidebar, the overview and the command menu. */
export const CATEGORY_ORDER: Category[] = ["Layout", "Content", "Data display", "Charts", "Maps", "Inputs", "Feedback", "Domain"];

export const CATEGORY_SLUG: Record<Category, string> = {
  Layout: "layout",
  Content: "content",
  "Data display": "data-display",
  Charts: "charts",
  Maps: "maps",
  Inputs: "inputs",
  Feedback: "feedback",
  Domain: "domain",
};

export const ALL_NAMES = Object.keys(definitions) as ComponentName[];

export function namesIn(cat: Category): ComponentName[] {
  return ALL_NAMES.filter((n) => definitions[n].category === cat);
}

export const GROUPS = CATEGORY_ORDER.map((cat) => ({ cat, items: namesIn(cat) })).filter((g) => g.items.length);

/** Flat order (sidebar order) used for prev/next links. */
export const FLAT: ComponentName[] = GROUPS.flatMap((g) => g.items);

export function isComponentName(n: string): n is ComponentName {
  return Object.prototype.hasOwnProperty.call(definitions, n);
}
