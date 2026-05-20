import React from "react";
import { cn } from "@/lib/utils";

interface DeepAgentsIconProps {
  className?: string;
  width?: number;
  height?: number;
}

const DEFAULT_CLASSNAME = "text-icon";

const DeepAgentsIcon = ({
  className,
  width = 16,
  height = 16,
}: DeepAgentsIconProps) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 98 98"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(DEFAULT_CLASSNAME, className)}
    >
      <path
        d="M72.5361 42.2004V22.0426H51.7354L51.7354 22.5212C62.5113 22.7991 71.2917 31.6243 72.1695 42.2004H72.5361Z"
        fill="currentColor"
      />
      <path
        d="M49.223 22.0428H24.8759V63.0891C24.8759 70.6689 30.7215 75.3844 40.133 75.3844H72.5471V45.3962H49.223V22.0428Z"
        fill="currentColor"
      />
    </svg>
  );
};

export default DeepAgentsIcon;
