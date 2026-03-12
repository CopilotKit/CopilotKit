import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CrossIncidentTimeline } from '../CrossIncidentTimeline'
import type { Incident } from '../../types/incident'

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'INC-1',
    title: 'API Gateway Down',
    description: 'Gateway errors',
    severity: 'P0',
    status: 'Open',
    affectedServices: [],
    detectionSource: 'alert',
    timestamps: { created: new Date().toISOString() },
    timeline: [],
    ...overrides,
  }
}

describe('CrossIncidentTimeline', () => {
  it('renders empty state when no events', () => {
    render(<CrossIncidentTimeline incidents={[]} onIncidentClick={vi.fn()} />)
    expect(screen.getByText(/No activity yet/)).toBeInTheDocument()
  })

  it('renders empty state with incidents that have no timeline', () => {
    render(
      <CrossIncidentTimeline
        incidents={[makeIncident({ timeline: [] })]}
        onIncidentClick={vi.fn()}
      />
    )
    expect(screen.getByText(/No activity yet/)).toBeInTheDocument()
  })

  it('renders timeline events from multiple incidents', () => {
    const incidents = [
      makeIncident({
        id: '1',
        title: 'API Down',
        timeline: [
          {
            id: 'e1',
            timestamp: new Date().toISOString(),
            type: 'status_change',
            description: 'Incident created',
            author: 'System',
          },
        ],
      }),
      makeIncident({
        id: '2',
        title: 'DB Timeout',
        timeline: [
          {
            id: 'e2',
            timestamp: new Date().toISOString(),
            type: 'comment',
            description: 'Investigating connection pool',
            author: 'Mike',
          },
        ],
      }),
    ]

    render(<CrossIncidentTimeline incidents={incidents} onIncidentClick={vi.fn()} />)

    expect(screen.getByText('API Down')).toBeInTheDocument()
    expect(screen.getByText('DB Timeout')).toBeInTheDocument()
    expect(screen.getByText(/Incident created/)).toBeInTheDocument()
    expect(screen.getByText(/Investigating connection pool/)).toBeInTheDocument()
  })

  it('renders event type labels', () => {
    const incident = makeIncident({
      timeline: [
        {
          id: 'e1',
          timestamp: new Date().toISOString(),
          type: 'status_change',
          description: 'Status updated',
        },
      ],
    })

    render(<CrossIncidentTimeline incidents={[incident]} onIncidentClick={vi.fn()} />)
    expect(screen.getByText('status change')).toBeInTheDocument()
  })

  it('renders author when present', () => {
    const incident = makeIncident({
      timeline: [
        {
          id: 'e1',
          timestamp: new Date().toISOString(),
          type: 'comment',
          description: 'Some comment',
          author: 'Sarah Chen',
        },
      ],
    })

    render(<CrossIncidentTimeline incidents={[incident]} onIncidentClick={vi.fn()} />)
    expect(screen.getByText(/by Sarah Chen/)).toBeInTheDocument()
  })

  it('calls onIncidentClick when incident title is clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const incident = makeIncident({
      title: 'Click Me',
      timeline: [
        {
          id: 'e1',
          timestamp: new Date().toISOString(),
          type: 'comment',
          description: 'Event',
        },
      ],
    })

    render(<CrossIncidentTimeline incidents={[incident]} onIncidentClick={onClick} />)
    await user.click(screen.getByText('Click Me'))
    expect(onClick).toHaveBeenCalledWith(incident)
  })

  it('shows "Show all" button when events exceed default max', () => {
    const events = Array.from({ length: 25 }, (_, i) => ({
      id: `e-${i}`,
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
      type: 'comment' as const,
      description: `Event ${i}`,
    }))

    const incident = makeIncident({ timeline: events })
    render(<CrossIncidentTimeline incidents={[incident]} onIncidentClick={vi.fn()} />)

    expect(screen.getByText(/Show all 25 events/)).toBeInTheDocument()
  })

  it('shows all events after clicking "Show all"', async () => {
    const user = userEvent.setup()
    const events = Array.from({ length: 25 }, (_, i) => ({
      id: `e-${i}`,
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
      type: 'comment' as const,
      description: `Event ${i}`,
    }))

    const incident = makeIncident({ timeline: events })
    render(<CrossIncidentTimeline incidents={[incident]} onIncidentClick={vi.fn()} />)

    await user.click(screen.getByText(/Show all 25 events/))
    // All events should now be visible
    expect(screen.getByText(/Event 24/)).toBeInTheDocument()
    expect(screen.queryByText(/Show all/)).not.toBeInTheDocument()
  })

  it('does not show "Show all" when events are within limit', () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      id: `e-${i}`,
      timestamp: new Date().toISOString(),
      type: 'comment' as const,
      description: `Event ${i}`,
    }))

    const incident = makeIncident({ timeline: events })
    render(<CrossIncidentTimeline incidents={[incident]} onIncidentClick={vi.fn()} />)

    expect(screen.queryByText(/Show all/)).not.toBeInTheDocument()
  })
})
