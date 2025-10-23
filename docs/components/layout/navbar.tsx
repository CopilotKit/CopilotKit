"use client"

import Image from "next/image"
import Link from "fumadocs-core/link"
import { usePathname } from "next/navigation"
import { Logo } from "@/app/logo"
import SearchDialog from "@/components/ui/search-dialog"

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

  return (
    <div className="h-[64px] lg:h-[80px] p-1 lg:p-2 fixed top-0 left-0 right-0 z-50">
      <div className="flex justify-between items-center w-full h-full rounded-2xl border backdrop-blur-lg border-white/10 bg-white/5">
        <div className="flex gap-11 items-center h-full">
          <Logo className="pl-6" />
          <ul className="hidden gap-6 items-center h-full lg:flex">
            {LEFT_LINKS.map((link) => (
              <li key={link.href} className="relative h-full">
                <Link
                  href={link.href}
                  target={link.target}
                  className={`h-full ${
                    activeRoute === link.href ? "opacity-100" : "opacity-50"
                  }`}
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

        <div className="flex gap-1 items-center pr-4">
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

          <button className="flex justify-center items-center w-11 h-full cursor-pointer">
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

          <SearchDialog />
        </div>
      </div>
    </div>
  )
}

export default Navbar
