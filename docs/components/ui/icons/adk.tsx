import React from "react"
import { cn } from "@/lib/utils"

interface AdkIconProps {
  className?: string
}

const DEFAULT_CLASSNAME = "text-icon"

const AdkIcon = ({ className }: AdkIconProps) => {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(DEFAULT_CLASSNAME, className)}
    >
      <path
        d="M11 1C5.477 1 1 5.477 1 11s4.477 10 10 10 10-4.477 10-10S16.523 1 11 1zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8z"
        fill="currentColor"
      />
      <path
        d="M11 5c-3.309 0-6 2.691-6 6s2.691 6 6 6 6-2.691 6-6-2.691-6-6-6zm0 10c-2.206 0-4-1.794-4-4s1.794-4 4-4 4 1.794 4 4-1.794 4-4 4z"
        fill="currentColor"
      />
      <circle cx="11" cy="11" r="2" fill="currentColor" />
    </svg>
  )
}

export default AdkIcon

