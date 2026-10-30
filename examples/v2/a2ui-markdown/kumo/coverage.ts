import type { StandardComponentName } from "./types";

/**
 * How the Kumo catalog renders a standard component:
 * - "kumo": a Kumo component.
 * - "composed": several Kumo parts, because Kumo has no single equivalent.
 * - "primitive": the unstyled Base UI primitive that Kumo re-exports,
 *   styled with Kumo tokens.
 * - "standard": no Kumo counterpart. The standard renderer, with the Kumo
 *   theme (./theme.ts).
 */
export type KumoCoverage = "kumo" | "composed" | "primitive" | "standard";

/** Every standard component, and how the Kumo catalog renders it. */
export const KUMO_COVERAGE = {
  // Layout
  Box: "standard",
  Column: "standard",
  Row: "standard",
  Grid: "standard",
  GridItem: "standard",
  Card: "standard",
  Flow: "standard",
  FlowItem: "standard",
  Carousel: "standard",
  CarouselItem: "standard",
  CarouselMediaItem: "standard",
  Spacer: "standard",
  Divider: "standard",
  Tabs: "standard",
  // Text
  Title: "standard",
  Text: "standard",
  Caption: "standard",
  Label: "standard",
  Bold: "standard",
  Italic: "standard",
  Underline: "standard",
  Strikethrough: "standard",
  Badge: "standard",
  Blockquote: "standard",
  Code: "standard",
  Markdown: "standard",
  Math: "standard",
  ShimmerText: "standard",
  Link: "standard",
  Tooltip: "standard",
  // Inputs
  Button: "standard",
  Pressable: "standard",
  Form: "standard",
  TextField: "standard",
  TextArea: "standard",
  Select: "standard",
  CheckBox: "standard",
  Radio: "standard",
  RadioGroup: "standard",
  Slider: "standard",
  SegmentedControl: "standard",
  ChoicePicker: "standard",
  DateTimeInput: "standard",
  // Feedback
  PulseIndicator: "standard",
  FlashcardFlip: "standard",
  Popover: "standard",
  PopoverTrigger: "standard",
  PopoverContent: "standard",
  Modal: "standard",
  // Data
  Table: "standard",
  TableSection: "standard",
  TableRow: "standard",
  TableCell: "standard",
  List: "standard",
  ListItem: "standard",
  Chart: "standard",
  Map: "standard",
  // Media
  Image: "standard",
  Icon: "composed",
  Favicon: "standard",
  Svg: "standard",
  Video: "standard",
  AudioPlayer: "standard",
  HtmlView: "standard",
  // Composites
  LinkCard: "standard",
  Citation: "standard",
  FollowUp: "standard",
  EntityCard: "standard",
  ImageGrid: "standard",
} as const satisfies Record<StandardComponentName, KumoCoverage>;
