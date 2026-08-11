import type { NavRoute } from "@/shell/skin-contract";
import { LayoutDashboard, Compass, LayoutGrid, Library } from "lucide-react";

/**
 * Display-only. `resolvePage` in skin.tsx is the sole segment validator, and it
 * additionally resolves `boards/<id>`, which nav deliberately does not list.
 */
export const vantageNav: NavRoute[] = [
  { segment: "", label: "Boardroom", icon: LayoutDashboard },
  { segment: "explore", label: "Explore", icon: Compass },
  { segment: "boards", label: "Boards", icon: LayoutGrid },
  { segment: "metrics", label: "Semantic layer", icon: Library },
];
