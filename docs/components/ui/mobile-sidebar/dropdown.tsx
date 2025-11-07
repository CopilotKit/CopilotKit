import { useEffect, useState, useRef } from "react"
import { createPortal } from "react-dom"
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
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 })
  const [isPositionReady, setIsPositionReady] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const pathname = usePathname()

  useEffect(() => {
    const activeItem = DROPDOWN_ITEMS.find((item) => item.href === pathname)
    if (activeItem) setSelectedItem(activeItem)
  }, [isOpen, pathname])

  useEffect(() => {
    if (isOpen && buttonRef.current) {
      setIsPositionReady(false)
      const updatePosition = () => {
        if (buttonRef.current) {
          const rect = buttonRef.current.getBoundingClientRect()
          setPosition({
            top: rect.bottom + 8,
            left: rect.left,
            width: rect.width,
          })
          setIsPositionReady(true)
        }
      }

      const handleClickOutside = (event: MouseEvent) => {
        if (
          buttonRef.current &&
          !buttonRef.current.contains(event.target as Node) &&
          !(event.target as Element).closest("[data-dropdown-menu]")
        ) {
          setIsOpen(false)
        }
      }

      updatePosition()
      window.addEventListener("scroll", updatePosition, true)
      window.addEventListener("resize", updatePosition)
      document.addEventListener("mousedown", handleClickOutside)

      return () => {
        window.removeEventListener("scroll", updatePosition, true)
        window.removeEventListener("resize", updatePosition)
        document.removeEventListener("mousedown", handleClickOutside)
        setIsPositionReady(false)
      }
    } else {
      setIsPositionReady(false)
    }
  }, [isOpen])

  return (
    <>
      <div className="relative">
        <button
          ref={buttonRef}
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
      </div>
      {isOpen &&
        isPositionReady &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            data-dropdown-menu
            className="z-[60] fixed rounded-xl border border-foreground/10 dark:border-white/5 dark:bg-background/30 bg-white/50 backdrop-blur-3xl p-1"
            style={{
              top: `${position.top}px`,
              left: `${position.left}px`,
              width: `${position.width}px`,
            }}
          >
            {DROPDOWN_ITEMS.map((item) => (
              <div
                key={item.href}
                onClick={() => setIsOpen(false)}
                className="flex justify-start items-center pl-2 h-12 rounded-xl"
              >
                <Link
                  href={item.href}
                  className="flex gap-2 items-center w-full"
                >
                  {item.icon}
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  )
}

export default Dropdown
