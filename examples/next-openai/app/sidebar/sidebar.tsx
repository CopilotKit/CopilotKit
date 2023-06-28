import React, { useContext } from 'react'
import { SidebarContext } from './sidebar-context'
import { Chat } from '@/chat-components/chat'

export function Sidebar() {
  const { isSidebarOpen, toggleSidebar } = useContext(SidebarContext)

  return (
    <div className={`bg-green-500 opacity-40 w-96 h-full shadow-lg`}>
      <div className="bg-purple-100 w-full h-full">
        <Chat />
      </div>
    </div>
  )
}
