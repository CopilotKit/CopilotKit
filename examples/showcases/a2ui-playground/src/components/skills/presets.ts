import type { SkillComponent } from "@/a2ui/export/skills";

export type SkillPreset = { id: string; label: string; names: string[] };

/** What every focused skill needs to lay out an answer: containers, headings, text and a button. */
const BASE = [
  "Column",
  "Row",
  "Grid",
  "Card",
  "Section",
  "Divider",
  "Heading",
  "Title",
  "Text",
  "Caption",
  "Markdown",
  "Badge",
  "Icon",
  "Button",
];

/** Starting points for the skill builder, each a selection that can answer on its own. */
export function skillPresets(components: SkillComponent[]): SkillPreset[] {
  const all = components.map((c) => c.name);
  const inGroup = (...groups: string[]) =>
    components.filter((c) => groups.includes(c.group)).map((c) => c.name);
  const preset = (id: string, label: string, names: string[]) => ({
    id,
    label,
    names: all.filter((n) => names.includes(n)),
  });
  return [
    preset("all", "All", all),
    preset("standard", "Standard only", inGroup("Gen UI 2.0 standard")),
    preset("charts", "Charts", [
      ...BASE,
      ...inGroup("Charts"),
      "Stat",
      "StatGroup",
      "DataTable",
      "KeyValueList",
      "Progress",
      "RadialProgress",
      "ComparisonTable",
      "Callout",
    ]),
    preset("forms", "Forms", [
      ...BASE,
      ...inGroup("Inputs"),
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
      "Alert",
    ]),
    preset("travel", "Travel", [
      ...BASE,
      ...inGroup("Maps"),
      "FlightCard",
      "WeatherReport",
      "WeatherCard",
      "Agenda",
      "Timeline",
      "EventCard",
      "Image",
      "KeyValueList",
    ]),
    preset("shopping", "Shopping", [
      ...BASE,
      "ProductCard",
      "ComparisonTable",
      "ReceiptCard",
      "Rating",
      "TagList",
      "Image",
      "ImageGallery",
      "Callout",
    ]),
  ];
}
