'use client'

import React from 'react'
import { useState } from 'react'
import { useEffect, useContext, useRef } from 'react'
import { useMakeCopilotWritable } from './useMakeCopilotWritable'
import { Chat } from '@/components/chat'
import { Providers } from '@/components/providers'
import { useMakeCopilotReadable } from './useMakeCopilotReadable'

export default function CopilotControlled() {
  const [searchFieldText, setSearchFieldText] = useState('')

  useMakeCopilotWritable({
    description: 'Set the search field text to the given value',
    argumentAnnotations: [
      {
        name: 'searchTerm',
        type: 'string',
        description: 'The text we wish to search for',
        required: true
      }
    ],
    implementation: (searchTerm: string) => {
      setSearchFieldText(searchTerm)
    }
  })

  useMakeCopilotReadable('Speak like a pirate! Argh!')

  return (
    <div>
      <h1>Controlled Copilot</h1>

      <h2>Search</h2>
      <input
        type="text"
        value={searchFieldText}
        onChange={e => setSearchFieldText(e.target.value)}
      />

      <div
        id="top-parent-full-screen-width"
        className="w-full items-center justify-center"
      >
        <div id="chat-max-width-container" className="w-1/2 mx-auto">
          <div id="chat-parent" className="w-full p-3 rounded-lg bg-slate-50">
            <Providers>
              <Chat />
            </Providers>
          </div>
        </div>
      </div>
    </div>
  )
}
