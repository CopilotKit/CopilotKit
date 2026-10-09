import type { NativeNodeKind } from "@copilotkit/channels-ui";

export interface TeamsCatalogEntry {
  readonly component: string;
  readonly type: string;
  readonly kind: NativeNodeKind;
  readonly version: string;
  readonly propertyVersions: Readonly<Record<string, string>>;
  readonly fixedProps: Readonly<Record<string, unknown>>;
  readonly childrenSlot?: string;
  readonly source: string;
  readonly preview?: true;
}

const SOURCE = "https://adaptivecards.microsoft.com/";

const PROPERTY_VERSIONS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  AdaptiveCard: { metadata: "1.4", refresh: "1.4", resources: "1.5" },
  Badge: {
    appearance: "1.5",
    icon: "1.5",
    iconPosition: "1.5",
    shape: "1.5",
    size: "1.5",
    style: "1.5",
    text: "1.5",
    tooltip: "1.5",
  },
  Image: {
    backgroundColor: "1.1",
    fitMode: "1.5",
    height: "1.1",
    horizontalContentAlignment: "1.5",
    selectAction: "1.1",
    themedUrls: "1.5",
    verticalContentAlignment: "1.5",
    width: "1.1",
  },
  "Input.ChoiceSet": {
    useMultipleColumns: "1.5",
    valueChangedAction: "1.5",
    wrap: "1.2",
  },
};

const FIXED_PROPS: Readonly<Record<string, Readonly<Record<string, unknown>>>> =
  {
    Persona: { name: "graph.microsoft.com/user" },
    PersonaSet: { name: "graph.microsoft.com/users" },
    File: { name: "graph.microsoft.com/file" },
    GraphResource: { name: "graph.microsoft.com/resource" },
    CalendarEvent: { name: "graph.microsoft.com/event" },
  };

type ManifestRow = readonly [
  component: string,
  type: string,
  version: string,
  childrenSlot?: string,
];

export const TEAMS_ELEMENT_MANIFEST = [
  ["ActionSet", "ActionSet", "1.2", "actions"],
  ["Badge", "Badge", "1.0"],
  ["Carousel", "Carousel", "1.5", "pages"],
  ["CodeBlock", "CodeBlock", "1.5"],
  ["ColumnSet", "ColumnSet", "1.2", "columns"],
  ["CompoundButton", "CompoundButton", "1.5"],
  ["Container", "Container", "1.2", "items"],
  ["FactSet", "FactSet", "1.2", "facts"],
  ["Icon", "Icon", "1.5"],
  ["Image", "Image", "1.2"],
  ["ImageSet", "ImageSet", "1.2", "images"],
  ["Media", "Media", "1.2", "sources"],
  ["ProgressBar", "ProgressBar", "1.5"],
  ["ProgressRing", "ProgressRing", "1.5"],
  ["Rating", "Rating", "1.5"],
  ["RichTextBlock", "RichTextBlock", "1.2", "inlines"],
  ["Table", "Table", "1.5", "rows"],
  ["TextBlock", "TextBlock", "1.2"],
] as const satisfies readonly ManifestRow[];

export const TEAMS_INPUT_MANIFEST = [
  ["ChoiceSet", "Input.ChoiceSet", "1.2", "choices"],
  ["Date", "Input.Date", "1.2"],
  ["Number", "Input.Number", "1.2"],
  ["Rating", "Input.Rating", "1.5"],
  ["Text", "Input.Text", "1.2"],
  ["Time", "Input.Time", "1.2"],
  ["Toggle", "Input.Toggle", "1.2"],
] as const satisfies readonly ManifestRow[];

export const TEAMS_CHART_MANIFEST = [
  ["Donut", "Chart.Donut", "1.5"],
  ["Pie", "Chart.Pie", "1.5"],
  ["Line", "Chart.Line", "1.5"],
  ["HorizontalBar", "Chart.HorizontalBar", "1.5"],
  ["HorizontalBarStacked", "Chart.HorizontalBar.Stacked", "1.5"],
  ["VerticalBar", "Chart.VerticalBar", "1.5"],
  ["VerticalBarGrouped", "Chart.VerticalBar.Grouped", "1.5"],
  ["Gauge", "Chart.Gauge", "1.5"],
] as const satisfies readonly ManifestRow[];

export const TEAMS_GRAPH_MANIFEST = [
  ["Persona", "Component", "1.5"],
  ["PersonaSet", "Component", "1.5", "personas"],
  ["File", "Component", "1.5"],
  ["GraphResource", "Component", "1.5"],
  ["CalendarEvent", "Component", "1.5"],
] as const satisfies readonly ManifestRow[];

/** The 38 body types marked as Teams-supported in the reviewed source. */
export const TEAMS_BODY_MANIFEST = [
  ...TEAMS_ELEMENT_MANIFEST,
  ...TEAMS_INPUT_MANIFEST,
  ...TEAMS_CHART_MANIFEST,
  ...TEAMS_GRAPH_MANIFEST,
] as const;

export const TEAMS_ACTION_MANIFEST = [
  ["Execute", "Action.Execute", "1.4"],
  ["OpenUrl", "Action.OpenUrl", "1.2"],
  ["Popover", "Action.Popover", "1.5", "items"],
  ["ResetInputs", "Action.ResetInputs", "1.5"],
  ["ShowCard", "Action.ShowCard", "1.2", "card"],
  ["Submit", "Action.Submit", "1.2"],
  ["ToggleVisibility", "Action.ToggleVisibility", "1.2", "targetElements"],
] as const satisfies readonly ManifestRow[];

export const TEAMS_LAYOUT_MANIFEST = [
  ["Column", "Column", "1.2", "items"],
  ["TableRow", "TableRow", "1.5", "cells"],
  ["TableCell", "TableCell", "1.5", "items"],
  ["TextRun", "TextRun", "1.2"],
  ["Fact", "Fact", "1.2"],
  ["Choice", "Input.Choice", "1.2"],
  ["MediaSource", "MediaSource", "1.2"],
  ["CaptionSource", "CaptionSource", "1.5"],
  ["TargetElement", "TargetElement", "1.2"],
  ["CarouselPage", "CarouselPage", "1.5", "items"],
  ["DataPoint", "DataPoint", "1.5"],
  ["ChartData", "ChartData", "1.5", "data"],
  ["FlowLayout", "Layout.Flow", "1.5"],
  ["AreaGridLayout", "Layout.AreaGrid", "1.5"],
] as const satisfies readonly ManifestRow[];

export const TEAMS_PREVIEW_MANIFEST = [
  ["Accordion", "Accordion", "1.6", "items"],
  ["LoopComponent", "LoopComponent", "1.6", "items"],
  ["TabSet", "TabSet", "1.6", "tabs"],
  ["RunCommands", "Action.RunCommands", "1.6", "commands"],
] as const satisfies readonly ManifestRow[];

function entries(
  rows: readonly ManifestRow[],
  kind: NativeNodeKind,
  preview = false,
): TeamsCatalogEntry[] {
  return rows.map(([component, type, version, childrenSlot]) => ({
    component,
    type,
    kind,
    version,
    propertyVersions:
      PROPERTY_VERSIONS[component] ?? PROPERTY_VERSIONS[type] ?? {},
    fixedProps: FIXED_PROPS[component] ?? {},
    ...(childrenSlot ? { childrenSlot } : {}),
    source: SOURCE,
    ...(preview ? { preview: true as const } : {}),
  }));
}

export const TEAMS_NATIVE_MANIFEST: readonly TeamsCatalogEntry[] = [
  {
    component: "AdaptiveCard",
    type: "AdaptiveCard",
    kind: "root",
    version: "1.2",
    propertyVersions: PROPERTY_VERSIONS.AdaptiveCard ?? {},
    fixedProps: {},
    childrenSlot: "body",
    source: SOURCE,
  },
  ...entries(TEAMS_ELEMENT_MANIFEST, "element"),
  ...entries(TEAMS_INPUT_MANIFEST, "input"),
  ...entries(TEAMS_CHART_MANIFEST, "chart"),
  ...entries(TEAMS_GRAPH_MANIFEST, "element"),
  ...entries(TEAMS_ACTION_MANIFEST, "action"),
  ...entries(TEAMS_LAYOUT_MANIFEST, "layout"),
  ...entries(TEAMS_PREVIEW_MANIFEST, "preview", true),
];
