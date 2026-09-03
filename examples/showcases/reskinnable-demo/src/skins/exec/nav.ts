import { LayoutDashboard, Landmark, LineChart, FileText } from "lucide-react";
import type { NavRoute } from "@/shell/skin-contract";

export const execNav: NavRoute[] = [
  { segment: "", label: "CEO dashboard", icon: LayoutDashboard },
  { segment: "finance", label: "CFO dashboard", icon: Landmark },
  { segment: "metrics", label: "Metrics", icon: LineChart },
  { segment: "packs", label: "Board packs", icon: FileText },
];
