import React from "react";
import { cn } from "@/lib/utils";

interface LoaderProps {
  size?: "small" | "medium" | "large";
  color?: string;
  className?: string;
}

export function Loader({
  size = "medium",
  color = "currentColor",
  className,
}: LoaderProps) {
  return (
    <div className={cn("flex items-center justify-center", className)}>
      <svg
        className={cn(
          "animate-spin",
          size === "small" && "h-4 w-4",
          size === "medium" && "h-8 w-8",
          size === "large" && "h-12 w-12",
        )}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke={color}
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill={color}
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </div>
  );
}

export function LoaderOverlay() {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Loader size="large" color="white" />
    </div>
  );
}
