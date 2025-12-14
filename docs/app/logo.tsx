import Image from "next/image"
import { cn } from "@/lib/utils"

interface LogoProps {
  className?: string
  width?: number
  height?: number
}

const DESKTOP_WIDTH = 179
const DESKTOP_HEIGHT = 26
const COMMON_CLASSNAMES =
  "aspect-[179/26] w-[164px] h-[24px] lg:w-[179px] lg:h-[26px] shrink-0"

export function Logo({
  className,
  width = DESKTOP_WIDTH,
  height = DESKTOP_HEIGHT,
}: LogoProps) {
  return (
    <div className={cn("flex justify-center items-center", className)}>
      <Image
        src="/images/logo-light.svg"
        width={width}
        height={height}
        alt="Logo"
        className={cn("block dark:hidden", COMMON_CLASSNAMES)}
      />
      <Image
        src="/images/logo-dark.svg"
        width={width}
        height={height}
        alt="Logo"
        className={cn("hidden dark:block", COMMON_CLASSNAMES)}
      />
    </div>
  )
}
