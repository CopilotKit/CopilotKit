import { cn } from "@/lib/utils";

interface PulseIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

const PulseIcon = ({ className }: PulseIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    className={cn(DEFAULT_CLASSNAME, className)}
  >
    <path
      fill="currentColor"
      d="M18.75 10a.625.625 0 0 1-.625.625h-2.114l-2.952 5.905a.625.625 0 0 1-.559.345h-.031a.625.625 0 0 1-.553-.402L7.449 4.747l-2.505 5.511a.625.625 0 0 1-.569.367h-2.5a.625.625 0 1 1 0-1.25h2.098L6.93 2.866a.625.625 0 0 1 1.153.036L12.577 14.7l2.489-4.977a.625.625 0 0 1 .559-.347h2.5a.625.625 0 0 1 .625.625Z"
    />
  </svg>
);
export default PulseIcon;
