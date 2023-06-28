'use client'

import React from 'react'
import { Providers } from '@/chat-components/providers'
import { Sidebar } from './sidebar/sidebar'
import { GoodPeopleBadPeople } from '@/components/good-people-bad-people'

export default function CopilotControlled() {
  return (
    <Providers>
      <GoodPeopleBadPeople />
    </Providers>
  )
}
