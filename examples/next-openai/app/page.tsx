'use client'

import React from 'react'
import { useState } from 'react'
import { useEffect, useContext, useRef } from 'react';
import { useMakeCopilotWritable } from './useMakeCopilotWritable';

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
      <p>
        This example shows how to use Copilot in a controlled way. The search
        field below is controlled by the component, and the Copilot is
        configured to use the value of the search field as the query.
      </p>
      <h2>Search</h2>
      <input
        type="text" 
        value={searchFieldText}
        onChange={(e) => setSearchFieldText(e.target.value)}
      />
      <h2>Results</h2>
      <div>
        TBD
        </div>

    </div>
  )
}




