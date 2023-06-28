'use client'

import * as React from 'react'
import { ThemeProviderProps } from 'next-themes/dist/types'

import { TooltipProvider } from '@/chat-components/ui/tooltip'
import { CopilotProvider } from '@/app/copilot-context'
import { ThemeProvider } from 'next-themes'

export function Providers({ children, ...props }: ThemeProviderProps) {
  return (
    <CopilotProvider>
      <ThemeProvider {...props}>
        <TooltipProvider>{children}</TooltipProvider>
      </ThemeProvider>
    </CopilotProvider>
  )
}
