// Sidebar icon registry. NavNode carries the raw spec string
// (e.g. `"lucide/Paintbrush"`) read from MDX/meta.json frontmatter;
// `resolveSidebarIcon` turns it into a React element that the
// PageTree → Fumadocs sidebar can render directly.
//
// We import only the lucide icons we actually reference so the
// client bundle doesn't pick up the entire lucide library. When a
// new icon name appears in content frontmatter, add it to the map
// below (and to the lucide imports above).

import React from "react";
import { LanggraphIcon } from "@/components/icons/framework-icons";
import { CopilotKitMark } from "@/components/copilotkit-mark";
import {
  // Pages / sections
  Bolt,
  BookA,
  BookOpen,
  Boxes,
  Brain,
  BrainCircuit,
  Brush,
  Bug,
  CirclePause,
  Cloud,
  Code,
  Cog,
  Component,
  Cpu,
  Database,
  Eye,
  FileJson,
  Gauge,
  Globe,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  MessageSquare,
  MessageSquareMore,
  Mic,
  Monitor,
  MousePointer,
  Network,
  Paintbrush,
  Paperclip,
  Play,
  Plug,
  Repeat,
  Rocket,
  SearchCheck,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  TextSelect,
  Terminal,
  RefreshCw,
  TriangleAlert,
  User,
  Users,
  Wand2,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";

// Lookup table keyed by the exact `"lucide/<Name>"` spec strings used
// in MDX frontmatter and meta.json `icon` fields. Add to this map (and
// to the import block above) when content references a new lucide icon.
const ICONS: Record<string, React.ReactNode> = {
  "lucide/Bolt": <Bolt />,
  "lucide/BookA": <BookA />,
  "lucide/BookOpen": <BookOpen />,
  "lucide/Boxes": <Boxes />,
  "lucide/Brain": <Brain />,
  "lucide/BrainCircuit": <BrainCircuit />,
  "lucide/Brush": <Brush />,
  "lucide/Bug": <Bug />,
  "lucide/CirclePause": <CirclePause />,
  "lucide/Cloud": <Cloud />,
  "lucide/Code": <Code />,
  "lucide/Cog": <Cog />,
  "lucide/Component": <Component />,
  "lucide/Cpu": <Cpu />,
  "lucide/Database": <Database />,
  "lucide/Eye": <Eye />,
  "lucide/FileJson": <FileJson />,
  "lucide/Gauge": <Gauge />,
  "lucide/Globe": <Globe />,
  "lucide/LayoutDashboard": <LayoutDashboard />,
  "lucide/LifeBuoy": <LifeBuoy />,
  "lucide/ListChecks": <ListChecks />,
  "lucide/MessageSquare": <MessageSquare />,
  "lucide/MessageSquareMore": <MessageSquareMore />,
  "lucide/Mic": <Mic />,
  "lucide/Monitor": <Monitor />,
  "lucide/MousePointer": <MousePointer />,
  "lucide/Network": <Network />,
  "lucide/Paintbrush": <Paintbrush />,
  "lucide/Paperclip": <Paperclip />,
  "lucide/Play": <Play />,
  "lucide/Plug": <Plug />,
  "lucide/RefreshCw": <RefreshCw />,
  "lucide/Repeat": <Repeat />,
  "lucide/Rocket": <Rocket />,
  "lucide/SearchCheck": <SearchCheck />,
  "lucide/Server": <Server />,
  "lucide/Settings": <Settings />,
  "lucide/Shield": <Shield />,
  "lucide/SlidersHorizontal": <SlidersHorizontal />,
  "lucide/Sparkles": <Sparkles />,
  "lucide/Terminal": <Terminal />,
  "lucide/TextSelect": <TextSelect />,
  "lucide/TriangleAlert": <TriangleAlert />,
  "lucide/User": <User />,
  "lucide/Users": <Users />,
  "lucide/Wand2": <Wand2 />,
  "lucide/Workflow": <Workflow />,
  "lucide/Wrench": <Wrench />,
  "lucide/Zap": <Zap />,
  // Custom marks — used by section headers for framework / enterprise
  // scaffolding. The CopilotKit kite is the inline gradient mark from
  // BrandNav; the LangGraph mark comes from the framework-icons set so
  // its visual treatment matches the framework picker.
  "custom/langgraph": <LanggraphIcon />,
  "custom/copilotkit-kite": <CopilotKitMark />,
};

export function resolveSidebarIcon(spec: string | undefined): React.ReactNode {
  if (!spec) return undefined;
  const icon = ICONS[spec];
  if (!icon || !React.isValidElement(icon)) return icon;
  // Fumadocs's `SidebarSeparator` renders `[item.icon, item.name]` as a
  // child array, so React warns about missing keys. Clone with a
  // stable key here so each separator gets clean child reconciliation
  // without us editing fumadocs internals.
  return React.cloneElement(icon, { key: "icon" });
}
