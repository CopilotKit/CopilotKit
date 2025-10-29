import Image from "next/image"

interface IconProps {
  src: string
  width?: number
  height?: number
  className?: string
}

const DEFAULT_WIDTH = 20
const DEFAULT_HEIGHT = 20

const Icon = ({
  src,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  className,
}: IconProps) => {
  return (
    <Image
      src={src}
      alt="Icon"
      width={width}
      height={height}
      className={className}
    />
  )
}

export default Icon
