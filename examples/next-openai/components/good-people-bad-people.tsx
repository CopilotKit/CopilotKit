import { useMakeCopilotWritable } from '@/app/useMakeCopilotWritable'
import React, { useState } from 'react'
import PersonList, { peopleListA, peopleListB } from './person-list'

export function GoodPeopleBadPeople(): JSX.Element {
  const [searchFieldText, setSearchFieldText] = useState('')

  useMakeCopilotWritable(
    {
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
    },
    []
  )

  return (
    <>
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
    </>
  )
}
