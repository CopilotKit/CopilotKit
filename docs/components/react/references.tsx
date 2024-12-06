import Link from 'next/link'

interface Reference {
  title: string
  link: string
}

interface ReferenceChipsProps {
  header: string
  references: Reference[]
}

export function ReferenceChips({ header, references }: ReferenceChipsProps) {
  return (
    <div className="mb-8">
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{header}</p>
      <div className="flex flex-wrap gap-2">
        {references.map((reference, index) => (
          <Link 
            key={index}
            href={reference.link}
            className="inline-block px-3 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-300 rounded-full text-sm font-medium hover:bg-violet-200 dark:hover:bg-violet-800/40 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:focus:ring-violet-400 transition-colors"
          >
            {reference.title}
          </Link>
        ))}
      </div>
    </div>
  )
}