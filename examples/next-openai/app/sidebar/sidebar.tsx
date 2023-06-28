import { Chat } from '@/chat-components/chat'
import React from 'react'

export function Sidebar() {
  return (
    <div
      className="shadow-lg bg-white"
      style={{ width: '100%', height: '100%' }}
    >
      <Chat />
    </div>
  )
}
