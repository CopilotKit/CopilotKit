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
  Box: "kumo",
  Column: "standard",
  Row: "standard",
  Grid: "kumo",
  GridItem: "kumo",
  Card: "kumo",
  Flow: "standard",
  FlowItem: "standard",
  Carousel: "standard",
  CarouselItem: "standard",
  CarouselMediaItem: "standard",
  Spacer: "standard",
  Divider: "primitive",
  Tabs: "kumo",
  // Text
  Title: "kumo",
  Text: "kumo",
  Caption: "kumo",
  Label: "kumo",
  Bold: "kumo",
  Italic: "kumo",
  Underline: "kumo",
  Strikethrough: "kumo",
  Badge: "kumo",
  Blockquote: "composed",
  Code: "kumo",
  Markdown: "standard",
  Math: "standard",
  ShimmerText: "composed",
  Link: "kumo",
  Tooltip: "kumo",
  // Inputs
  Button: "kumo",
  Pressable: "standard",
  Form: "primitive",
  TextField: "kumo",
  TextArea: "kumo",
  Select: "kumo",
  CheckBox: "kumo",
  Radio: "composed",
  RadioGroup: "kumo",
  Slider: "kumo",
  SegmentedControl: "kumo",
  ChoicePicker: "composed",
  DateTimeInput: "composed",
  // Feedback
  PulseIndicator: "standard",
  FlashcardFlip: "composed",
  Popover: "kumo",
  PopoverTrigger: "kumo",
  PopoverContent: "kumo",
  Modal: "kumo",
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
