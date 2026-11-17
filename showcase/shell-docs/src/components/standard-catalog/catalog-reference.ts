import { scopeFromPath } from "@/lib/live-scope";
import { SAMPLES } from "./catalog-data";

/**
 * The standard catalog's per-component reference pages, ported from
 * shell-docs (`src/components/standard-catalog/catalog-reference.ts`): one page
 * per standalone component at `/generative-ui/components/standard-catalog/<slug>`,
 * with its structural parts (`GridItem`, `TableRow`, ...) as sections of
 * their parent's page (`/grid#grid-item`).
 */
export const CATALOG_REFERENCE_PATH =
  "/generative-ui/components/standard-catalog";

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

/**
 * The standalone components by group, as the catalog page's "What is in it"
 * table lists them; the sidebar's Standard catalog folder follows it.
 */
export const CATALOG_GROUPS: { title: string; components: string[] }[] = [
  {
    title: "Layout",
    components: [
      "Box",
      "Column",
      "Row",
      "Grid",
      "Card",
      "Flow",
      "Carousel",
      "Spacer",
      "Divider",
      "Tabs",
    ],
  },
  {
    title: "Text",
    components: [
      "Title",
      "Text",
      "Caption",
      "Label",
      "Bold",
      "Italic",
      "Underline",
      "Strikethrough",
      "Badge",
      "Blockquote",
      "Code",
      "Markdown",
      "Math",
      "ShimmerText",
      "Link",
      "Tooltip",
    ],
  },
  {
    title: "Inputs",
    components: [
      "Button",
      "Pressable",
      "Form",
      "TextField",
      "TextArea",
      "Select",
      "CheckBox",
      "Radio",
      "RadioGroup",
      "Slider",
      "SegmentedControl",
      "ChoicePicker",
      "DateTimeInput",
    ],
  },
  { title: "Data", components: ["Table", "List", "Chart", "Map"] },
  {
    title: "Media",
    components: [
      "Image",
      "Icon",
      "Favicon",
      "Svg",
      "Video",
      "AudioPlayer",
      "HtmlView",
    ],
  },
  {
    title: "Feedback and overlay",
    components: ["PulseIndicator", "FlashcardFlip", "Popover", "Modal"],
  },
  {
    title: "Composites",
    components: ["LinkCard", "Citation", "FollowUp", "EntityCard", "ImageGrid"],
  },
];

export function catalogComponentNames() {
  return [...NAMES];
}

function catalogStandaloneNames() {
  return NAMES.filter((name) => !PART_PARENTS[name]);
}

/** The component whose page documents a part (`GridItem` is on Grid's). */
export function catalogPartParent(name: string): string | undefined {
  return PART_PARENTS[name];
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

/** A standalone component's parts, documented on its page. */
export function catalogParts(name: string) {
  return NAMES.filter((part) => PART_PARENTS[part] === name);
}

/**
 * The component a docs URL's path names, and the URL's frontend and framework
 * prefix (`/vue/mastra`): the catalog index's links keep the reader's scope,
 * so a component page answers in every scope the index does.
 */
export function catalogReferenceFromPath(
  path: string[],
): { name: string; prefix: string } | null {
  const scope = scopeFromPath(path);
  const rest = path.slice(scope.prefix.split("/").filter(Boolean).length);
  const base = CATALOG_REFERENCE_PATH.split("/").filter(Boolean);
  if (
    rest.length !== base.length + 1 ||
    base.some((segment, i) => rest[i] !== segment)
  )
    return null;
  const slug = rest[base.length];
  const name = catalogStandaloneNames().find(
    (candidate) => catalogComponentSlug(candidate) === slug,
  );
  return name ? { name, prefix: scope.prefix } : null;
}
