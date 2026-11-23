import {
  ChartLine,
  ClipboardList,
  FileText,
  Images,
  MapPin,
  SlidersHorizontal,
  Table2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The views a reader can ask for from the composer's + menu. Each names the
 * catalog components the agent should reach for; the agent still decides
 * what goes in them.
 */
export interface ViewKind {
  id: string;
  label: string;
  note: string;
  icon: LucideIcon;
  tone: string;
  /** What the agent is told when the reader picks this view. */
  instruction: string;
}

export const VIEW_CATALOG: ViewKind[] = [
  {
    id: "chart",
    label: "Chart",
    note: "Trends and comparisons",
    icon: ChartLine,
    tone: "var(--tone-cyan)",
    instruction:
      "Show the answer with a Chart: a line for change over time, bars for a comparison.",
  },
  {
    id: "table",
    label: "Table",
    note: "Options side by side",
    icon: Table2,
    tone: "var(--tone-blue)",
    instruction: "Show the answer as a Table the reader can scan and compare.",
  },
  {
    id: "calculator",
    label: "Calculator",
    note: "Sliders that recompute",
    icon: SlidersHorizontal,
    tone: "var(--tone-green)",
    instruction:
      "Give the reader Slider controls bound to the data model and compute the results with calc, so the view answers as they adjust it.",
  },
  {
    id: "form",
    label: "Form",
    note: "Questions for you first",
    icon: ClipboardList,
    tone: "var(--tone-violet)",
    instruction:
      "Before answering, ask for what you need from the reader with a compact Form.",
  },
  {
    id: "pictures",
    label: "Pictures",
    note: "Photos of the subject",
    icon: Images,
    tone: "var(--tone-magenta)",
    instruction:
      "Call find_images and show the pictures in an ImageGrid, each with its description and credit.",
  },
  {
    id: "map",
    label: "Map",
    note: "Places on a map",
    icon: MapPin,
    tone: "var(--tone-orange)",
    instruction: "Show the places involved on a Map.",
  },
  {
    id: "report",
    label: "Report",
    note: "A document beside the chat",
    icon: FileText,
    tone: "var(--tone-yellow)",
    instruction:
      "Write the answer as a report in the report sheet, and reply in the chat in a sentence or two.",
  },
];
