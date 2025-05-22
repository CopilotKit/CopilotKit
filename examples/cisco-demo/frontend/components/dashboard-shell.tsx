"use client"

import type React from "react"

import { usePathname } from "next/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { ModeToggle } from "@/components/mode-toggle"
import { Code2, FlaskConical, LayoutDashboard, LogOut, Settings, TestTube2, TrendingUp } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import Link from "next/link"
import { useCopilotChat } from "@copilotkit/react-core"

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { setMessages } = useCopilotChat()
  const routes = [
    {
      title: "Developer",
      href: "/developer",
      icon: Code2,
      isActive: pathname === "/developer" || pathname === "/",
    },
    {
      title: "Tester",
      href: "/tester",
      icon: TestTube2,
      isActive: pathname === "/tester",
    },
    {
      title: "Lab Admin",
      href: "/lab-admin",
      icon: FlaskConical,
      isActive: pathname === "/lab-admin",
    },
    {
      title: "Executive",
      href: "/executive",
      icon: TrendingUp,
      isActive: pathname === "/executive",
    },
  ]

  return (
    <div className="flex h-full flex-1">
      <Sidebar side="left" className="border-r">
        <SidebarHeader className="flex justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-6 w-6" />
            <h1 className="text-xl font-semibold tracking-tight">EnterpriseX</h1>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {routes.map((route) => (
              <SidebarMenuItem key={route.href} className="p-3 px-6" >
                <SidebarMenuButton asChild isActive={route.isActive}>
                  <Link onClick={() => setMessages([])} href={route.href}>
                    <route.icon className="mr-2 h-5 w-5" />
                    <span>{route.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link href="#">
                  <Settings className="mr-2 h-5 w-5" />
                  <span>Settings</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link href="#">
                  <LogOut className="mr-2 h-5 w-5" />
                  <span>Logout</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center gap-4 border-b bg-background px-6">
          <div className="ml-auto flex items-center gap-4">
            {/* <ModeToggle /> */}
            <Avatar>
              <AvatarImage src="/abstract-geometric-shapes.png" />
              <AvatarFallback>JD</AvatarFallback>
            </Avatar>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  )
}
