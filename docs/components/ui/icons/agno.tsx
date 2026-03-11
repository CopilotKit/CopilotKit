import React from "react";
import { cn } from "@/lib/utils";

interface AgnoIconProps {
  className?: string;
  width?: number;
  height?: number;
}

const DEFAULT_CLASSNAME = "text-icon";

const AgnoIcon = ({ className, width = 20, height = 18 }: AgnoIconProps) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 20 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(DEFAULT_CLASSNAME, className)}
    >
      <path
        d="M12.8184 0H4.63127V2.9279H10.8196L16.0933 17.2121H19.5L12.8184 0Z"
        fill="currentColor"
      />
      <path
        d="M8.38314 14.2843H0V17.2122H8.38314V14.2843Z"
        fill="currentColor"
      />
    </svg>
  );
};

export default AgnoIcon;
