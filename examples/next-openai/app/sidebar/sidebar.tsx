import { Chat } from '@/chat-components/chat'
import React from 'react'

export interface SidebarProps {
  setSidebarOpen: (open: boolean) => void
}

export function Sidebar(props: SidebarProps): JSX.Element {
  return (
    <div
      className="shadow-lg bg-white flex flex-col"
      style={{ width: '100%', height: '100%' }}
    >
      <SidebarTopBar {...props} />
      <Chat />
    </div>
  )
}

import { XMarkIcon } from '@heroicons/react/24/outline'

function SidebarTopBar(props: SidebarProps): JSX.Element {
  return (
    <div className="py-6 bg-white flex items-center justify-between px-4">
      <h1 className="text-base font-semibold leading-6 text-gray-900">
        Copilot Chat
      </h1>
      <div className="ml-3 flex h-7 items-center">
        <button
          type="button"
          className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          onClick={() => props.setSidebarOpen(false)}
        >
          <span className="sr-only">Close panel</span>
          <XMarkIcon className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
