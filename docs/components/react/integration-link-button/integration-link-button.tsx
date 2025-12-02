import Image from "next/image"
import Link from "fumadocs-core/link"

export type IntegrationLinkButtonProps = {
  label: string
  icon: string
  href: string
  width: number
  height: number
}

export const IntegrationLinkButton = ({
  label,
  icon,
  href,
  width,
  height,
}: IntegrationLinkButtonProps) => {
  return (
    <Link
      href={href}
      className="w-full no-underline h-[60px] hover:opacity-100"
    >
      <div className="flex gap-2 justify-between items-center p-1 w-full h-full rounded-lg bg-background/50 hover:bg-[#1A2022] group pr-4">
        <div className="flex gap-2 justify-start items-center w-full">
          <div className="w-[52px] h-[52px] flex items-center justify-center bg-white/5 rounded-md group-hover:bg-[#7076D5] transition-all duration-200">
            <Image src={icon} alt={label} width={width} height={height} />
          </div>
          <span className="text-sm font-medium no-underline">{label}</span>
        </div>

        <div className="hidden group-hover:block">
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M17.3172 10.4423L11.6922 16.0673C11.5749 16.1846 11.4159 16.2505 11.25 16.2505C11.0841 16.2505 10.9251 16.1846 10.8078 16.0673C10.6905 15.95 10.6247 15.791 10.6247 15.6251C10.6247 15.4593 10.6905 15.3002 10.8078 15.1829L15.3664 10.6251H3.125C2.95924 10.6251 2.80027 10.5593 2.68306 10.442C2.56585 10.3248 2.5 10.1659 2.5 10.0001C2.5 9.83434 2.56585 9.67537 2.68306 9.55816C2.80027 9.44095 2.95924 9.3751 3.125 9.3751H15.3664L10.8078 4.81729C10.6905 4.70002 10.6247 4.54096 10.6247 4.3751C10.6247 4.20925 10.6905 4.05019 10.8078 3.93292C10.9251 3.81564 11.0841 3.74976 11.25 3.74976C11.4159 3.74976 11.5749 3.81564 11.6922 3.93292L17.3172 9.55792C17.3753 9.61596 17.4214 9.68489 17.4529 9.76077C17.4843 9.83664 17.5005 9.91797 17.5005 10.0001C17.5005 10.0822 17.4843 10.1636 17.4529 10.2394C17.4214 10.3153 17.3753 10.3842 17.3172 10.4423Z"
              fill="white"
            />
          </svg>
        </div>
      </div>
    </Link>
  )
}
