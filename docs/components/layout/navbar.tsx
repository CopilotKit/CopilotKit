"use client"

import Image from "next/image"
import Link from "fumadocs-core/link"
import { usePathname } from "next/navigation"
import { Logo } from "@/app/logo"
import SearchDialogButton from "@/components/ui/search-button"

interface NavbarLinks {
  href: string
  icon: string
  label?: string
  target?: "_blank" | "_self" | "_parent" | "_top"
  showExternalLinkIcon?: boolean
}

const LEFT_LINKS: NavbarLinks[] = [
  {
    icon: "/images/navbar/overview",
    label: "Overview",
    href: "/",
  },
  {
    icon: "/images/navbar/integrations",
    label: "Integrations",
    href: "/integrations",
  },
  {
    icon: "/images/navbar/api-reference",
    label: "API Reference",
    href: "/reference",
  },
  {
    icon: "/images/navbar/copilot-cloud",
    label: "Copilot Cloud",
    href: "https://cloud.copilotkit.ai",
    target: "_blank",
    showExternalLinkIcon: true,
  },
]

const RIGHT_LINKS: NavbarLinks[] = [
  {
    icon: "/images/navbar/github",
    href: "https://github.com/copilotkit/copilotkit",
    target: "_blank",
  },
  {
    icon: "/images/navbar/discord",
    href: "https://discord.gg/6dffbvGU3D",
    target: "_blank",
  },
]

const Navbar = () => {
  const pathname = usePathname()
  const activeRoute = pathname.split("/")[1] || "/"

  const handleToggleTheme = () => {
    document.documentElement.classList.toggle("dark")
    localStorage.theme = localStorage.theme === "dark" ? "light" : "dark"
  }

  return (
    <nav className="h-[68px] xl:h-[88px] p-1 xl:p-2">
      <div className="flex justify-between items-center w-full h-full">
        <div className="flex w-full h-full">
          <div className="flex gap-11 items-center w-full h-full rounded-l-2xl border border-r-0 backdrop-blur-lg border-border bg-glass-background">
            <Logo className="pl-6" />
            <ul className="hidden gap-6 items-center h-full xl:flex">
              {LEFT_LINKS.map((link) => (
                <li key={link.href} className="relative h-full">
                  <Link
                    href={link.href}
                    target={link.target}
                    className={`h-full ${
                      activeRoute === link.href ? "opacity-100" : "opacity-50"
                    } hover:opacity-100 transition-opacity duration-300`}
                  >
                    <span className="flex gap-2 items-center h-full">
                      <Image
                        src={`${link.icon}-dark.svg`}
                        alt={link.label ?? `Navbar link icon for ${link.href}`}
                        width={20}
                        height={20}
                        className="hidden dark:inline-block"
                      />
                      <Image
                        src={`${link.icon}-light.svg`}
                        alt={link.label ?? `Navbar link icon for ${link.href}`}
                        width={20}
                        height={20}
                        className="dark:hidden"
                      />

                      <span className="text-sm font-medium">{link.label}</span>

                      {link.showExternalLinkIcon && (
                        <>
                          <Image
                            src="/images/navbar/external-link-dark.svg"
                            alt="External link icon"
                            width={20}
                            height={20}
                            className="hidden dark:inline-block"
                          />
                          <Image
                            src="/images/navbar/external-link-light.svg"
                            alt="External link icon"
                            width={20}
                            height={20}
                            className="dark:hidden"
                          />
                        </>
                      )}
                    </span>
                  </Link>
                  {activeRoute === link.href && (
                    <div className="absolute bottom-0 left-0 w-full h-[3px] bg-[#7076D5]" />
                  )}
                </li>
              ))}
            </ul>
          </div>

          <Image
            src="/images/navbar/slanted-end-border-dark.svg"
            alt="Slanted end border"
            width={29}
            height={72}
            className="hidden -ml-px dark:inline-block shrink-0 w-[24px] h-[60px] xl:w-[29px] xl:h-[72px] object-cover"
          />
          <Image
            src="/images/navbar/slanted-end-border-light.svg"
            alt="Slanted end border"
            width={29}
            height={72}
            className="-ml-px dark:hidden shrink-0 w-[24px] h-[60px] xl:w-[29px] xl:h-[72px] object-cover"
          />
        </div>

        <div className="flex items-center w-max h-full shrink-0">
          <Image
            src="/images/navbar/slanted-start-border-dark.svg"
            alt="Slanted start border"
            width={29}
            height={72}
            className="hidden -mr-px dark:inline-block shrink-0 w-[24px] h-[60px] xl:w-[29px] xl:h-[72px] object-cover"
          />
          <Image
            src="/images/navbar/slanted-start-border-light.svg"
            alt="Slanted start border"
            width={29}
            height={72}
            className="-mr-px dark:hidden shrink-0 w-[24px] h-[60px] xl:w-[29px] xl:h-[72px] object-cover"
          />

          <div className="flex gap-1 items-center pr-4 w-max h-full rounded-r-2xl border border-l-0 backdrop-blur-lg shrink-0 border-border bg-glass-background">
            {RIGHT_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                target={link.target}
                className="flex justify-center items-center w-11 h-full"
              >
                <span className="flex gap-2 items-center h-full">
                  <Image
                    src={`${link.icon}-dark.svg`}
                    alt={link.label ?? `Navbar link icon for ${link.href}`}
                    width={20}
                    height={20}
                    className="hidden dark:inline-block"
                  />
                  <Image
                    src={`${link.icon}-light.svg`}
                    alt={link.label ?? `Navbar link icon for ${link.href}`}
                    width={20}
                    height={20}
                    className="dark:hidden"
                  />
                </span>
              </Link>
            ))}

            <button
              className="flex justify-center items-center w-11 h-full cursor-pointer"
              onClick={handleToggleTheme}
            >
              <Image
                src="/images/navbar/theme-moon.svg"
                alt="Theme icon"
                width={20}
                height={20}
                className="hidden dark:inline-block"
              />
              <Image
                src="/images/navbar/theme-sun.svg"
                alt="Theme icon"
                width={20}
                height={20}
                className="dark:hidden"
              />
            </button>

            <SearchDialogButton />
          </div>
        </div>
      </div>
    </nav>
  )
}

export default Navbar
