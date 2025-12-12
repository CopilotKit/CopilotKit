import React from "react"
import { cn } from "@/lib/utils"

interface MicrosoftIconProps {
  className?: string
  width?: number
  height?: number
}

const DEFAULT_CLASSNAME = "text-icon"

export const MicrosoftIcon = ({ className, width = 20, height = 20 }: MicrosoftIconProps) => {
  return (
    <svg
      stroke='currentColor'
      fill='currentColor'
      stroke-width='0'
      viewBox='0 0 448 512'
      height='200px'
      className={cn(DEFAULT_CLASSNAME, className)}
      width='200px'
      style={{ width: `${width}px`, height: `${height}px` }}
      xmlns='http://www.w3.org/2000/svg'>
      <path d='M0 32h214.6v214.6H0V32zm233.4 0H448v214.6H233.4V32zM0 265.4h214.6V480H0V265.4zm233.4 0H448V480H233.4V265.4z'></path>
    </svg>
  );
};
