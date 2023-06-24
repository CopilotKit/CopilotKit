'use client'

import React from 'react'
import { useState } from 'react'
import { useEffect, useContext, useRef } from 'react';
import { useMakeCopilotWritable } from './useMakeCopilotWritable';
import { Chat } from '@/components/chat';
import { Providers } from '@/components/providers';

export default function CopilotControlled() {
  const [searchFieldText, setSearchFieldText] = useState('')
  
  useMakeCopilotWritable({
    description: 'Set the search field text to the given value',
    argumentAnnotations: [
      {
        name: 'searchTerm',
        type: 'string',
        description: 'The text we wish to search for',
        required: true,
      },
    ],
    implementation: (searchTerm: string) => {
      setSearchFieldText(searchTerm)
    }
  })

  return (
    <div>
      <h1>Controlled Copilot</h1>

      <h2>Search</h2>
      <input
        type="text" 
        value={searchFieldText}
        onChange={(e) => setSearchFieldText(e.target.value)}
      />

<Providers>
<Chat></Chat>

</Providers>

    </div>
  )
}




