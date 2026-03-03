import { cn } from "@/lib/utils";

interface ServerIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

const ServerIcon = ({ className }: ServerIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    className={cn(DEFAULT_CLASSNAME, className)}
  >
    <path
      fill="currentColor"
      d="M16.25 10.625H3.75a1.25 1.25 0 0 0-1.25 1.25v3.75a1.25 1.25 0 0 0 1.25 1.25h12.5a1.25 1.25 0 0 0 1.25-1.25v-3.75a1.25 1.25 0 0 0-1.25-1.25Zm0 5H3.75v-3.75h12.5v3.75Zm0-12.5H3.75a1.25 1.25 0 0 0-1.25 1.25v3.75a1.25 1.25 0 0 0 1.25 1.25h12.5a1.25 1.25 0 0 0 1.25-1.25v-3.75a1.25 1.25 0 0 0-1.25-1.25Zm0 5H3.75v-3.75h12.5v3.75ZM15 6.25a.938.938 0 1 1-1.875 0 .938.938 0 0 1 1.875 0Zm0 7.5a.937.937 0 1 1-1.875 0 .937.937 0 0 1 1.875 0Z"
    />
  </svg>
);
export default ServerIcon;
