import type { FrontendIcon } from "@/lib/frontend-options";
import {
  Code,
  Component,
  MessageSquare,
  Smartphone,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const FRONTEND_ICONS: Record<FrontendIcon, LucideIcon> = {
  react: Component,
  vue: Code,
  "react-native": Smartphone,
  slack: MessageSquare,
  teams: Users,
};

export function FrontendLogo({
  icon,
  size = 18,
  className,
}: {
  icon: FrontendIcon;
  size?: number;
  className?: string;
}) {
  const Icon = FRONTEND_ICONS[icon];
  return (
    <Icon
      aria-hidden="true"
      className={className}
      size={size}
      strokeWidth={2}
    />
  );
}
