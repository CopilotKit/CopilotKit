import type { SVGProps } from "react";

/** Drawn icons, one stroke weight (1.5) on a 16px grid. Decorative unless labelled. */
function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export function ArrowRight(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </Icon>
  );
}

export function ArrowUpRight(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 11l6-6M6 5h5v5" />
    </Icon>
  );
}

export function Tick(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </Icon>
  );
}

export function Close(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  );
}

/** A side panel: collapse when open, expand when closed (the chevron flips). */
export function PanelToggle({
  collapsed,
  ...props
}: SVGProps<SVGSVGElement> & { collapsed: boolean }) {
  return (
    <Icon {...props}>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M6 2.5v11" />
      <path d={collapsed ? "M9 6.5l1.5 1.5L9 9.5" : "M11 6.5L9.5 8l1.5 1.5"} />
    </Icon>
  );
}
