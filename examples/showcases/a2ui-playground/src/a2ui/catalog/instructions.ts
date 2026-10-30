/**
 * When to use which component: the design rules every model that writes this
 * catalog follows. The composer puts them in its prompt, the exported catalog
 * carries them as `instructions`, and the generated skill repeats them, so an
 * agent outside the playground composes the same way.
 */
export const DESIGN_RULES = [
  "Fully answer the request. Lead with a Heading, then the component built for the job: comparisons -> ComparisonTable, plans/options -> RadioGroup or ProductCard, schedules -> Agenda or Timeline, code -> CodeBlock, people -> ProfileCard or Avatar/AvatarGroup, statuses -> Badge, ratings -> Rating, a single ratio or score -> RadialProgress or Gauge, recipes -> RecipeCard, events -> EventCard, products -> ProductCard, flights -> FlightCard, weather -> WeatherCard. Pick the richest component that fits: charts for numbers over time or comparisons, MapView for places, DataTable for many rows, Timeline for sequences, domain cards when they match.",
  "Layout with Column, Row and Grid. Use Card only for an interactive panel (a form, controls) and Section to group with a title. Short text is Text, Title or Caption; prose is Markdown.",
  "Make the layout make sense: one chart per question unless the user asks for more, never two charts or a chart plus a table showing the same numbers, and never a chart whose series is flat or has under 3 points (use a Stat instead).",
  "Put KPIs in a Grid of Stat (add a Sparkline when a trend matters). Aim for 8 to 18 components, never more than 20: show each fact once (never the same list in both a map and a table), prefer one rich component over many small ones, but use small ones (Badge, Avatar, Divider) where they carry meaning.",
  'Concise copy, specific realistic data. If numbers are illustrative (no live source), end with a Caption saying "Illustrative data".',
  "Multi-series charts share one axis: only combine series of similar magnitude. Otherwise plot % change from a common start, or use one chart per series.",
  'Percent values are 0-100 (12.4 means 12.4%) with format "percent"; never fractions.',
  'Subtitles describe the content ("Revenue grew 12% on EMEA renewals"), never the UI itself.',
  "Maps: at most 8 markers, each a specific named place (landmark, venue, neighbourhood) that the plan text mentions, one per stop. Never use the city itself as a marker.",
  "Stat values are short numbers; put qualitative takeaways in KeyValueList, Callout or Markdown.",
  'Write final copy. Never say "placeholder", "sample text" or "lorem". Never use em dashes.',
];

export const CATALOG_TITLE = "A2UI Playground catalog";
export const CATALOG_DESCRIPTION =
  "CopilotKit's Gen UI 2.0 standard components plus the playground's charts, maps, data views, inputs and domain cards, for dark chat surfaces.";

export const catalogInstructions = () => `## Design rules\n\n${DESIGN_RULES.map((r) => `- ${r}`).join("\n")}`;
