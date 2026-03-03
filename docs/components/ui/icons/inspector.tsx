import { cn } from "@/lib/utils";

interface InspectorIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

const InspectorIcon = ({ className }: InspectorIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    className={cn(DEFAULT_CLASSNAME, className)}
  >
    <g fill="currentColor">
      <path d="m17.942 17.058-3.912-3.911a6.884 6.884 0 1 0-.883.883l3.91 3.912a.625.625 0 1 0 .885-.884ZM3.125 8.75a5.625 5.625 0 1 1 5.625 5.625A5.631 5.631 0 0 1 3.125 8.75Z" />
      <path d="M12.11 6.432a.626.626 0 0 1 0 .884l-3.75 3.75a.624.624 0 0 1-.885 0L5.6 9.191a.625.625 0 1 1 .884-.884l1.433 1.434 3.308-3.309a.625.625 0 0 1 .884 0Z" />
    </g>
  </svg>
);
export default InspectorIcon;
