'use client'

import React from 'react'
import { Providers } from '@/chat-components/providers'
import { GoodPeopleBadPeople } from '@/components/good-people-bad-people'
import { SidebarProvider } from './sidebar/sidebar-context'

export default function CopilotControlled() {
  return (
    <Providers>
      <SidebarProvider>
        <div className="w-full h-full bg-slate-300">
          <GoodPeopleBadPeople />
        </div>
      </SidebarProvider>
    </Providers>
  )
}
