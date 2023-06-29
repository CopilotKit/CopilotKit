import React, { createContext, ReactNode, useCallback } from 'react'
import { useState } from 'react'
import { Sidebar } from './sidebar'

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
export function SidebarProvider({ children }: SidebarProviderProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev)
  }, [])

  return (
    <SidebarContext.Provider
      value={{ isSidebarOpen: sidebarOpen, toggleSidebar }}
    >
      <>
        <div
          style={{
            height: '100vh',
            width: '100vw',
            position: 'relative'
          }}
        >
          <div
            style={{
              overflowY: 'auto',
              overflowX: 'hidden',
              height: '100%',
              width: sidebarOpen ? 'calc(100% - 450px)' : '100%', // New
              position: 'absolute', // New
              transition: 'width 0.5s ease-in-out' // New
            }}
          >
            <main>{children}</main>
          </div>
          <div
            style={{
              overflowY: 'auto',
              height: '100%',
              width: '450px',
              position: 'absolute',
              right: sidebarOpen ? '0' : '-450px',
              transition: 'right 0.5s ease-in-out'
            }}
          >
            <Sidebar setSidebarOpen={setSidebarOpen} />
          </div>
          {!sidebarOpen && (
            <button
              onClick={toggleSidebar}
              style={{
                position: 'absolute',
                top: '5%',
                right: '20px',
                transform: 'translateY(-50%)',
                transition: 'opacity 0.5s ease-in-out'
              }}
              className="bg-white text-black p-2 rounded-lg shadow-lg"
            >
              Open Copilot
            </button>
          )}
        </div>
      </>
    </SidebarContext.Provider>
  )
}
