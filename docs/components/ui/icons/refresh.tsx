import { cn } from "@/lib/utils";

interface RefreshIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

const RefreshIcon = ({ className }: RefreshIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="none"
    className={cn(DEFAULT_CLASSNAME, className)}
  >
    <path
      fill="currentColor"
      d="M17.5 3.75V7.5a.625.625 0 0 1-.625.625h-3.75a.625.625 0 1 1 0-1.25h2.241l-1.143-1.143a6.215 6.215 0 0 0-4.385-1.83h-.035A6.212 6.212 0 0 0 5.437 5.68a.625.625 0 0 1-.874-.893 7.5 7.5 0 0 1 10.547.061l1.14 1.143V3.75a.625.625 0 1 1 1.25 0Zm-2.937 10.57a6.25 6.25 0 0 1-8.786-.052l-1.143-1.143h2.241a.625.625 0 0 0 0-1.25h-3.75a.625.625 0 0 0-.625.625v3.75a.625.625 0 1 0 1.25 0v-2.241l1.143 1.143a7.455 7.455 0 0 0 5.263 2.196h.042a7.45 7.45 0 0 0 5.24-2.135.626.626 0 0 0-.874-.893Z"
    />
  </svg>
);
export default RefreshIcon;
