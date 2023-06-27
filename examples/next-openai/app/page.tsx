'use client'

import React from 'react'
import { useState } from 'react'
import { useEffect, useContext, useRef } from 'react'
import { useMakeCopilotWritable } from './useMakeCopilotWritable'
import { Chat } from '@/chat-components/chat'
import { Providers } from '@/chat-components/providers'
import { useMakeCopilotReadable } from './useMakeCopilotReadable'
import PersonList, { peopleListA, peopleListB } from '@/components/person-list'

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
    <>
      <h1>Controlled Copilot</h1>

      <h2>Search</h2>
      <input
        type="text"
        value={searchFieldText}
        onChange={e => setSearchFieldText(e.target.value)}
        className="bg-slate-100 rounded-lg p-4 m-4 w-full"
        placeholder="Search..."
      />

      <div className=" bg-slate-100 rounded-lg p-4 m-4 mt-10">
        <PersonList title="Good people" people={peopleListA} />
      </div>

      <div className=" bg-slate-100 rounded-lg p-4 m-4 mt-40">
        <PersonList title="Bad people" people={peopleListB} />
      </div>

      <div
        id="top-parent-full-screen-width"
        className="w-full items-center justify-center h-96 bg-slate-500"
      >
        <div id="chat-max-width-container" className="w-1/2 h-full mx-auto">
          <div
            id="chat-parent"
            className="w-full p-3 rounded-lg bg-slate-50 h-full "
          >
            <Providers>
              <Chat />
            </Providers>
          </div>
        </div>
      </div>
    </>
  )
}
