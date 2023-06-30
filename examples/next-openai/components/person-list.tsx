import PersonCard, { Person } from './person-card'
import { useMakeCopilotReadable } from '@/app/use-make-copilot-readable'

export interface PersonListProps {
  title: string
  people: Person[]
}

export default function PersonList(props: PersonListProps) {
  const listId = useMakeCopilotReadable(`People list: ${props.title}`)

  const listItself = (
    <ul
      role="list"
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      {props.people.map(person => (
        <li
          key={person.email}
          className="col-span-1 divide-y divide-gray-200 rounded-lg bg-white shadow"
        >
          <PersonCard person={person} parentCopilotId={listId} />
        </li>
      ))}
    </ul>
  )

  return (
    <>
      <h2 className=" font-bold text-2xl pb-4"> {props.title}</h2>
      {listItself}
    </>
  )
}

export const peopleListA: Person[] = [
  {
    name: 'Jane Cooper',
    title: 'Regional Paradigm Technician',
    role: 'Admin',
    email: 'janecooper@example.com',
    telephone: '+1-202-555-0170',
    imageUrl:
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'John Smith',
    title: 'Senior Software Engineer',
    role: 'Engineering',
    email: 'johnsmith@example.com',
    telephone: '+1-202-555-0180',
    imageUrl:
      'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Emily Johnson',
    title: 'Marketing Manager',
    role: 'Marketing',
    email: 'emilyjohnson@example.com',
    telephone: '+1-202-555-0190',
    imageUrl:
      'https://images.unsplash.com/photo-1520813792240-56fc4a3765a7?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Michael Davis',
    title: 'Financial Analyst',
    role: 'Finance',
    email: 'michaeldavis@example.com',
    telephone: '+1-202-555-0200',
    imageUrl:
      'https://images.unsplash.com/photo-1498551172505-8ee7ad69f235?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Sarah Wilson',
    title: 'Customer Support Specialist',
    role: 'Support',
    email: 'sarahwilson@example.com',
    telephone: '+1-202-555-0210',
    imageUrl:
      'https://images.unsplash.com/photo-1532417344469-368f9ae6d187?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'David Anderson',
    title: 'Project Manager',
    role: 'Management',
    email: 'davidanderson@example.com',
    telephone: '+1-202-555-0220',
    imageUrl:
      'https://images.unsplash.com/photo-1566492031773-4f4e44671857?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Emma Thompson',
    title: 'Graphic Designer',
    role: 'Design',
    email: 'emmathompson@example.com',
    telephone: '+1-202-555-0230',
    imageUrl:
      'https://images.unsplash.com/photo-1522770179533-24471fcdba45?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Daniel Roberts',
    title: 'Sales Representative',
    role: 'Sales',
    email: 'danielroberts@example.com',
    telephone: '+1-202-555-0240',
    imageUrl:
      'https://images.unsplash.com/photo-1554423551-6c69a14588b3?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Olivia Moore',
    title: 'Human Resources Coordinator',
    role: 'HR',
    email: 'oliviamoore@example.com',
    telephone: '+1-202-555-0250',
    imageUrl:
      'https://images.unsplash.com/photo-1551808422-442b54b3f7c2?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Matthew Lee',
    title: 'Data Analyst',
    role: 'Analytics',
    email: 'matthewlee@example.com',
    telephone: '+1-202-555-0260',
    imageUrl:
      'https://images.unsplash.com/photo-1520222731644-9b87400e18b8?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Sophia Turner',
    title: 'Product Manager',
    role: 'Product',
    email: 'sophiaturner@example.com',
    telephone: '+1-202-555-0270',
    imageUrl:
      'https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  }
]

export const peopleListB: Person[] = [
  {
    name: 'Robert Brown',
    title: 'UX Designer',
    role: 'Design',
    email: 'robertbrown@example.com',
    telephone: '+1-202-555-0280',
    imageUrl:
      'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Victoria Taylor',
    title: 'Content Strategist',
    role: 'Marketing',
    email: 'victoriataylor@example.com',
    telephone: '+1-202-555-0290',
    imageUrl:
      'https://images.unsplash.com/photo-1534751516642-a1af1ef26a56?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'William Jackson',
    title: 'Database Administrator',
    role: 'Engineering',
    email: 'williamjackson@example.com',
    telephone: '+1-202-555-0300',
    imageUrl:
      'https://images.unsplash.com/photo-1566492031773-4f4e44671857?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Grace Lewis',
    title: 'Quality Assurance Analyst',
    role: 'QA',
    email: 'gracelewis@example.com',
    telephone: '+1-202-555-0310',
    imageUrl:
      'https://images.unsplash.com/photo-1532417344469-368f9ae6d187?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Samuel King',
    title: 'SEO Specialist',
    role: 'Marketing',
    email: 'samuelking@example.com',
    telephone: '+1-202-555-0320',
    imageUrl:
      'https://images.unsplash.com/photo-1498551172505-8ee7ad69f235?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Linda Wright',
    title: 'Frontend Developer',
    role: 'Engineering',
    email: 'lindawright@example.com',
    telephone: '+1-202-555-0330',
    imageUrl:
      'https://images.unsplash.com/photo-1520813792240-56fc4a3765a7?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Joshua Harris',
    title: 'Social Media Manager',
    role: 'Marketing',
    email: 'joshuaharris@example.com',
    telephone: '+1-202-555-0340',
    imageUrl:
      'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Jennifer Walker',
    title: 'Backend Developer',
    role: 'Engineering',
    email: 'jenniferwalker@example.com',
    telephone: '+1-202-555-0350',
    imageUrl:
      'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Charles Hall',
    title: 'HR Specialist',
    role: 'HR',
    email: 'charleshall@example.com',
    telephone: '+1-202-555-0360',
    imageUrl:
      'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Patricia Allen',
    title: 'Technical Writer',
    role: 'Support',
    email: 'patriciaallen@example.com',
    telephone: '+1-202-555-0370',
    imageUrl:
      'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  },
  {
    name: 'Christopher Scott',
    title: 'Risk Management Officer',
    role: 'Management',
    email: 'christopherscott@example.com',
    telephone: '+1-202-555-0380',
    imageUrl:
      'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?ixlib=rb-1.2.1&auto=format&fit=facearea&facepad=4&w=256&h=256&q=60'
  }
]
