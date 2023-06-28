import React, { createContext, useState, ReactNode } from 'react'

interface SidebarContextType {
  isSidebarOpen: boolean
  toggleSidebar: () => void
}

export const SidebarContext = createContext<SidebarContextType>({
  isSidebarOpen: false,
  toggleSidebar: () => {}
})

interface SidebarProviderProps {
  children: ReactNode
}

export function SidebarProvider({ children, ...props }: SidebarProviderProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen)
  }

  return (
    <SidebarContext.Provider
      value={{ isSidebarOpen, toggleSidebar }}
      {...props}
    >
      {children}
    </SidebarContext.Provider>
  )
}
