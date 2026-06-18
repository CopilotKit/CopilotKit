import React from "react";
import { SiReact, SiSlack, SiVuedotjs } from "react-icons/si";
import { TbBrandReactNative, TbBrandTeams } from "react-icons/tb";

interface FrontendIconProps {
  className?: string;
  width?: number;
  height?: number;
}

interface FrontendLogoProps extends FrontendIconProps {
  slug: string;
}

const FRONTEND_ICONS = {
  react: {
    icon: SiReact,
    library: "react-icons/si",
  },
  vue: {
    icon: SiVuedotjs,
    library: "react-icons/si",
  },
  "react-native": {
    icon: TbBrandReactNative,
    library: "react-icons/tb",
  },
  slack: {
    icon: SiSlack,
    library: "react-icons/si",
  },
  "microsoft-teams": {
    icon: TbBrandTeams,
    library: "react-icons/tb",
  },
} as const;

export function FrontendLogo({
  slug,
  className,
  width = 20,
  height = 20,
}: FrontendLogoProps) {
  const item = FRONTEND_ICONS[slug as keyof typeof FRONTEND_ICONS];
  if (!item) {
    return (
      <span
        aria-hidden="true"
        className={className}
        style={{ width, height, display: "inline-block" }}
      />
    );
  }

  const Icon = item.icon;
  return (
    <span
      aria-hidden="true"
      className={className}
      data-frontend-icon={slug}
      data-icon-library={item.library}
      style={{ width, height, display: "inline-flex" }}
    >
      <Icon fontSize={Math.max(width, height)} />
    </span>
  );
}
