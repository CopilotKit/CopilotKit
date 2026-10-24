import {
  Atom,
  BookOpen,
  Brain,
  Building2,
  ChartLine,
  Coins,
  Compass,
  Cpu,
  Dna,
  Factory,
  FlaskConical,
  Globe,
  GraduationCap,
  HeartPulse,
  Landmark,
  Leaf,
  Music,
  Plane,
  Rocket,
  Scroll,
  Thermometer,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The icons the agent picks from, keyed by the names in
 * `agent/src/research_desk/icons.py`. Each carries the Solarized accent it is
 * drawn in, so a glance down the thread list reads as subject matter.
 */
export const THREAD_ICONS: Record<string, { icon: LucideIcon; tone: string }> =
  {
    globe: { icon: Globe, tone: "var(--tone-blue)" },
    thermometer: { icon: Thermometer, tone: "var(--tone-orange)" },
    leaf: { icon: Leaf, tone: "var(--tone-green)" },
    flask: { icon: FlaskConical, tone: "var(--tone-violet)" },
    atom: { icon: Atom, tone: "var(--tone-violet)" },
    dna: { icon: Dna, tone: "var(--tone-magenta)" },
    "heart-pulse": { icon: HeartPulse, tone: "var(--tone-red)" },
    brain: { icon: Brain, tone: "var(--tone-magenta)" },
    landmark: { icon: Landmark, tone: "var(--tone-yellow)" },
    scroll: { icon: Scroll, tone: "var(--tone-yellow)" },
    "chart-line": { icon: ChartLine, tone: "var(--tone-cyan)" },
    coins: { icon: Coins, tone: "var(--tone-yellow)" },
    building: { icon: Building2, tone: "var(--tone-neutral)" },
    factory: { icon: Factory, tone: "var(--tone-neutral)" },
    plane: { icon: Plane, tone: "var(--tone-blue)" },
    rocket: { icon: Rocket, tone: "var(--tone-violet)" },
    cpu: { icon: Cpu, tone: "var(--tone-cyan)" },
    users: { icon: Users, tone: "var(--tone-blue)" },
    "graduation-cap": { icon: GraduationCap, tone: "var(--tone-violet)" },
    music: { icon: Music, tone: "var(--tone-magenta)" },
    "book-open": { icon: BookOpen, tone: "var(--tone-cyan)" },
    compass: { icon: Compass, tone: "var(--tone-neutral)" },
  };

/**
 * `name` undefined: the icon is still loading (a dashed ring). `null` or an
 * unknown name: the thread has no icon, so it gets the neutral compass.
 */
export function ThreadIcon({
  name,
  size = 16,
}: {
  name: string | null | undefined;
  size?: number;
}) {
  const entry =
    name === undefined
      ? undefined
      : (THREAD_ICONS[name ?? ""] ?? THREAD_ICONS.compass);
  if (!entry) {
    return (
      <span
        className="thread-icon thread-icon--pending"
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }
  const Icon = entry.icon;
  return (
    <Icon
      className="thread-icon"
      size={size}
      strokeWidth={1.75}
      color={entry.tone}
      aria-hidden
    />
  );
}
