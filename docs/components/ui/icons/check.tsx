import React from "react";
import { cn } from "@/lib/utils";

interface CheckIconProps {
  className?: string;
}

const DEFAULT_CLASSNAME = "text-icon";

const CheckIcon = ({ className }: CheckIconProps) => {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(DEFAULT_CLASSNAME, className)}
    >
      <path
        d="M14.3535 4.85378L6.35354 12.8538C6.3071 12.9003 6.25196 12.9372 6.19126 12.9623C6.13056 12.9875 6.0655 13.0004 5.99979 13.0004C5.93408 13.0004 5.86902 12.9875 5.80832 12.9623C5.74762 12.9372 5.69248 12.9003 5.64604 12.8538L2.14604 9.35378C2.05222 9.25996 1.99951 9.13272 1.99951 9.00003C1.99951 8.86735 2.05222 8.7401 2.14604 8.64628C2.23986 8.55246 2.36711 8.49976 2.49979 8.49976C2.63247 8.49976 2.75972 8.55246 2.85354 8.64628L5.99979 11.7932L13.646 4.14628C13.7399 4.05246 13.8671 3.99976 13.9998 3.99976C14.1325 3.99976 14.2597 4.05246 14.3535 4.14628C14.4474 4.2401 14.5001 4.36735 14.5001 4.50003C14.5001 4.63272 14.4474 4.75996 14.3535 4.85378Z"
        fill="currentColor"
      />
    </svg>
  );
};

export default CheckIcon;
