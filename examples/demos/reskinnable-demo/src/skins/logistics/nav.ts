import { Radar, Route, Boxes, ClipboardList } from "lucide-react";
import type { NavRoute } from "@/shell/skin-contract";

export const logisticsNav: NavRoute[] = [
  { segment: "", label: "Control Tower", icon: Radar },
  { segment: "lanes", label: "Lanes", icon: Route },
  { segment: "inventory", label: "Inventory", icon: Boxes },
  { segment: "decisions", label: "Decision Log", icon: ClipboardList },
];
