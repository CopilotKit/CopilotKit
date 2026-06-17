import type { FrontendIcon } from "@/lib/frontend-options";

export function FrontendLogo({
  icon,
  size = 18,
}: {
  icon: FrontendIcon;
  size?: number;
}) {
  if (icon === "vue") {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <path fill="#41B883" d="M2 4h8l6 10 6-10h8L16 28 2 4Z" />
        <path fill="#34495E" d="M10 4h5.2L16 5.4 16.8 4H22l-6 10-6-10Z" />
      </svg>
    );
  }

  if (icon === "slack") {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect x="13" y="2" width="6" height="13" rx="3" fill="#36C5F0" />
        <rect x="13" y="17" width="6" height="13" rx="3" fill="#2EB67D" />
        <rect x="17" y="13" width="13" height="6" rx="3" fill="#ECB22E" />
        <rect x="2" y="13" width="13" height="6" rx="3" fill="#E01E5A" />
        <rect x="20" y="2" width="6" height="6" rx="3" fill="#ECB22E" />
        <rect x="20" y="24" width="6" height="6" rx="3" fill="#2EB67D" />
        <rect x="2" y="20" width="6" height="6" rx="3" fill="#E01E5A" />
        <rect x="2" y="6" width="6" height="6" rx="3" fill="#36C5F0" />
      </svg>
    );
  }

  if (icon === "teams") {
    return (
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect x="10" y="8" width="17" height="18" rx="3" fill="#5059C9" />
        <circle cx="22.5" cy="6.5" r="4.5" fill="#7B83EB" />
        <circle cx="27" cy="11" r="3" fill="#7B83EB" opacity="0.9" />
        <rect x="2" y="10" width="16" height="14" rx="2" fill="#6264A7" />
        <path fill="#fff" d="M6 13.4h8v2H11v6H9v-6H6v-2Z" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="-16 -16 32 32" aria-hidden="true">
      <g fill="none" stroke="#61DAFB" strokeWidth="1.55">
        <ellipse rx="13" ry="5" />
        <ellipse rx="13" ry="5" transform="rotate(60)" />
        <ellipse rx="13" ry="5" transform="rotate(120)" />
      </g>
      <circle r={icon === "react-native" ? 2.6 : 2.2} fill="#61DAFB" />
    </svg>
  );
}
