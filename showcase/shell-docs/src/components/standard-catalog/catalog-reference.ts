import type { NavNode } from "@/lib/docs-render";
import { SAMPLES } from "./catalog-data";

export const CATALOG_REFERENCE_PATH =
  "/generative-ui/components/standard-catalog";
export const CATALOG_REFERENCE_GROUPS = [
  "Layout",
  "Text",
  "Inputs",
  "Data",
  "Media",
  "Feedback",
  "Composites",
];
const PART_PARENTS: Record<string, string> = {
  GridItem: "Grid",
  FlowItem: "Flow",
  CarouselItem: "Carousel",
  CarouselMediaItem: "Carousel",
  TableSection: "Table",
  TableRow: "Table",
  TableCell: "Table",
  ListItem: "List",
  PopoverTrigger: "Popover",
  PopoverContent: "Popover",
};
const NAMES = [...new Set(SAMPLES.flatMap((sample) => sample.covers))];

export function catalogComponentNames() {
  return [...NAMES];
}
export function catalogStandaloneNames() {
  return NAMES.filter((name) => !PART_PARENTS[name]);
}
export function catalogComponentSlug(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
export function catalogComponentHref(name: string) {
  if (!NAMES.includes(name))
    throw new Error(`Unknown catalog component: ${name}`);
  const parent = PART_PARENTS[name];
  return `${CATALOG_REFERENCE_PATH}/${catalogComponentSlug(parent ?? name)}${parent ? `#${catalogComponentSlug(name)}` : ""}`;
}
export function catalogReferenceName(slug: string) {
  return catalogStandaloneNames().find(
    (name) => catalogComponentSlug(name) === slug,
  );
}
export function catalogReferenceNameFromPath(path: string) {
  return path.startsWith(`${CATALOG_REFERENCE_PATH.slice(1)}/`)
    ? catalogReferenceName(path.slice(CATALOG_REFERENCE_PATH.length))
    : undefined;
}
export function isCatalogReferencePath(path: string) {
  return (
    path === CATALOG_REFERENCE_PATH.slice(1) ||
    path.startsWith(`${CATALOG_REFERENCE_PATH.slice(1)}/`)
  );
}
export function catalogParts(name: string) {
  return NAMES.filter((part) => PART_PARENTS[part] === name);
}
export function catalogExamples(name: string) {
  return SAMPLES.flatMap((sample, index) =>
    sample.covers.includes(name) ? [index] : [],
  );
}
export function catalogComponentGroup(name: string) {
  return SAMPLES.find((sample) =>
    sample.covers.includes(PART_PARENTS[name] ?? name),
  )!.group;
}
export function catalogReferenceNav(): NavNode[] {
  const nodes: NavNode[] = [
    {
      type: "page",
      title: "Overview",
      slug: CATALOG_REFERENCE_PATH.slice(1),
      href: CATALOG_REFERENCE_PATH,
    },
  ];
  for (const group of CATALOG_REFERENCE_GROUPS) {
    nodes.push({
      type: "section",
      title: group === "Feedback" ? "Feedback and overlay" : group,
    });
    nodes.push(
      ...catalogStandaloneNames()
        .filter((name) => catalogComponentGroup(name) === group)
        .sort()
        .map((name) => ({
          type: "page" as const,
          title: name,
          slug: catalogComponentHref(name).slice(1),
          href: catalogComponentHref(name),
        })),
    );
  }
  return nodes;
}
