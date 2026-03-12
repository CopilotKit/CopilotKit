import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IncidentsList } from '../IncidentsList'
import type { Incident } from '../../types/incident'

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'INC-1',
    title: 'API Gateway Down',
    description: 'Gateway returning 502 errors',
    severity: 'P0',
    status: 'Open',
    affectedServices: ['api-gateway', 'auth-service'],
    detectionSource: 'alert',
    timestamps: { created: '2024-01-01T00:00:00Z' },
    owner: 'Sarah Chen',
    timeline: [],
    ...overrides,
  }
}

describe('IncidentsList', () => {
  it('renders empty state when no incidents', () => {
    render(<IncidentsList incidents={[]} />)
    expect(screen.getByText('No incidents match your filters.')).toBeInTheDocument()
  })

  it('renders incident titles and descriptions', () => {
    const incidents = [
      makeIncident({ id: '1', title: 'API Down', description: 'Gateway errors' }),
      makeIncident({ id: '2', title: 'DB Timeout', description: 'Connection pool full' }),
    ]
    render(<IncidentsList incidents={incidents} />)

    expect(screen.getByText('API Down')).toBeInTheDocument()
    expect(screen.getByText('Gateway errors')).toBeInTheDocument()
    expect(screen.getByText('DB Timeout')).toBeInTheDocument()
    expect(screen.getByText('Connection pool full')).toBeInTheDocument()
  })

  it('renders severity badges', () => {
    const incidents = [
      makeIncident({ id: '1', severity: 'P0' }),
      makeIncident({ id: '2', severity: 'P3' }),
    ]
    render(<IncidentsList incidents={incidents} />)

    expect(screen.getByText('P0')).toBeInTheDocument()
    expect(screen.getByText('P3')).toBeInTheDocument()
  })

  it('renders status labels', () => {
    const incidents = [
      makeIncident({ id: '1', status: 'Open' }),
      makeIncident({ id: '2', status: 'Resolved' }),
    ]
    render(<IncidentsList incidents={incidents} />)

    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText('Resolved')).toBeInTheDocument()
  })

  it('renders affected services', () => {
    render(<IncidentsList incidents={[makeIncident()]} />)
    expect(screen.getByText('api-gateway, auth-service')).toBeInTheDocument()
  })

  it('renders owner', () => {
    render(<IncidentsList incidents={[makeIncident()]} />)
    expect(screen.getByText('Owner: Sarah Chen')).toBeInTheDocument()
  })

  it('does not render owner when absent', () => {
    render(<IncidentsList incidents={[makeIncident({ owner: undefined })]} />)
    expect(screen.queryByText(/Owner:/)).not.toBeInTheDocument()
  })

  it('calls onIncidentClick when an incident is clicked', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const incident = makeIncident()
    render(<IncidentsList incidents={[incident]} onIncidentClick={onClick} />)

    await user.click(screen.getByText('API Gateway Down'))
    expect(onClick).toHaveBeenCalledWith(incident)
  })

  it('does not crash when onIncidentClick is not provided', async () => {
    const user = userEvent.setup()
    render(<IncidentsList incidents={[makeIncident()]} />)
    // Should not throw
    await user.click(screen.getByText('API Gateway Down'))
  })
})
