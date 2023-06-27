import { EnvelopeIcon, PhoneIcon } from '@heroicons/react/20/solid'
import { useMakeCopilotReadable } from '@/app/useMakeCopilotReadable'

export interface Person {
  name: string
  title: string
  role: string
  email: string
  telephone: string
  imageUrl: string
}

export interface PersonCardProps {
  person: Person
  parentCopilotId?: string
}

export default function PersonCard(props: PersonCardProps) {
  const { person } = props

  const jsonString = JSON.stringify(person)
  useMakeCopilotReadable(`Person: ${jsonString}`, props.parentCopilotId)

  return (
    <>
      <div className="flex w-full items-center justify-between space-x-6 p-6">
        <div className="flex-1 truncate">
          <div className="flex items-center space-x-3">
            <h3 className="truncate text-sm font-medium text-gray-900">
              {person.name}
            </h3>
            <span className="inline-flex flex-shrink-0 items-center rounded-full bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20">
              {person.role}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-gray-500">{person.title}</p>
        </div>
        <img
          className="h-10 w-10 flex-shrink-0 rounded-full bg-gray-300"
          src={person.imageUrl}
          alt=""
        />
      </div>
      <div>
        <div className="-mt-px flex divide-x divide-gray-200">
          <div className="flex w-0 flex-1">
            <a
              href={`mailto:${person.email}`}
              className="relative -mr-px inline-flex w-0 flex-1 items-center justify-center gap-x-3 rounded-bl-lg border border-transparent py-4 text-sm font-semibold text-gray-900"
            >
              <EnvelopeIcon
                className="h-5 w-5 text-gray-400"
                aria-hidden="true"
              />
              Email
            </a>
          </div>
          <div className="-ml-px flex w-0 flex-1">
            <a
              href={`tel:${person.telephone}`}
              className="relative inline-flex w-0 flex-1 items-center justify-center gap-x-3 rounded-br-lg border border-transparent py-4 text-sm font-semibold text-gray-900"
            >
              <PhoneIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
              Call
            </a>
          </div>
        </div>
      </div>
    </>
  )
}
