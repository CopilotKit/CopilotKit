import type { FrontendIcon } from "@/lib/frontend-options";
import type React from "react";
import { BiLogoMicrosoftTeams } from "react-icons/bi";
import { SiAngular, SiReact, SiVuedotjs } from "react-icons/si";
import { TbBrandReactNative } from "react-icons/tb";

type BrandIcon = React.ComponentType<{
  "aria-hidden"?: boolean;
  className?: string;
  color?: string;
  focusable?: boolean | "false";
  size?: number | string;
  title?: string;
}>;

function SlackColorLogo({
  className,
  size = 18,
}: {
  "aria-hidden"?: boolean;
  className?: string;
  focusable?: boolean | "false";
  size?: number | string;
  title?: string;
}) {
  return (
    <svg
      aria-hidden={true}
      className={className}
      focusable={false}
      height={size}
      role="img"
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#E01E5A"
        d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z"
      />
      <path
        fill="#E01E5A"
        d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
      />
      <path
        fill="#36C5F0"
        d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z"
      />
      <path
        fill="#36C5F0"
        d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
      />
      <path
        fill="#2EB67D"
        d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z"
      />
      <path
        fill="#2EB67D"
        d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
      />
      <path
        fill="#ECB22E"
        d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z"
      />
      <path
        fill="#ECB22E"
        d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"
      />
    </svg>
  );
}

const FRONTEND_ICONS: Record<FrontendIcon, { Icon: BrandIcon; color: string }> =
  {
    react: { Icon: SiReact, color: "#61DAFB" },
    vue: { Icon: SiVuedotjs, color: "#4FC08D" },
    "react-native": { Icon: TbBrandReactNative, color: "#61DAFB" },
    angular: { Icon: SiAngular, color: "#DD0031" },
    slack: { Icon: SlackColorLogo, color: "currentColor" },
    teams: { Icon: BiLogoMicrosoftTeams, color: "#6264A7" },
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
  const { Icon, color } = FRONTEND_ICONS[icon];
  return (
    <Icon
      aria-hidden={true}
      className={className}
      color={color}
      focusable={false}
      size={size}
      title=""
    />
  );
}
