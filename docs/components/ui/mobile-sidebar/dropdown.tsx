import { useEffect, useState } from "react"
import Link from "fumadocs-core/link"
import { usePathname } from "next/navigation"
import {
  LEFT_LINKS as DROPDOWN_ITEMS,
  NavbarLink,
} from "@/components/layout/navbar"
import ChevronDownIcon from "@/components/ui/icons/chevron"

const Dropdown = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<NavbarLink | null>(
    DROPDOWN_ITEMS[0]
  )
  const pathname = usePathname()

  useEffect(() => {
    const activeItem = DROPDOWN_ITEMS.find((item) => item.href === pathname)
    if (activeItem) setSelectedItem(activeItem)
  }, [isOpen, pathname])

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex justify-between items-center px-3 w-full h-14 rounded-xl border border-foreground/10 dark:border-white/5 bg-white/5 ${
          isOpen && "!border-[#BEC2FF] dark:!border-[#7076D5]"
        }`}
      >
        <div className="flex gap-3 items-center">
          {selectedItem?.icon}
          <span className="text-sm font-medium">{selectedItem?.label}</span>
        </div>
        <ChevronDownIcon
          className={`text-foreground ${isOpen && "rotate-180"}`}
        />
      </button>
      {isOpen && (
        <div className="z-[60] absolute top-[calc(100%+8px)] left-0 w-full rounded-xl border border-foreground/10 dark:border-white/5 dark:bg-background/30 bg-white/50 backdrop-blur-3xl p-1">
          {DROPDOWN_ITEMS.map((item) => (
            <div
              key={item.href}
              onClick={() => setIsOpen(false)}
              className="flex justify-start items-center pl-2 h-12 rounded-xl"
            >
              <Link href={item.href} className="flex gap-2 items-center w-full">
                {item.icon}
                <span className="text-sm font-medium">{item.label}</span>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Dropdown
