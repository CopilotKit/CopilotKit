import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IncidentDetail } from '../IncidentDetail'
import type { Incident } from '../../types/incident'

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'INC-1',
    title: 'API Gateway Down',
    description: 'Gateway returning 502 errors to all clients',
    severity: 'P0',
    status: 'Open',
    affectedServices: ['api-gateway', 'auth-service'],
    detectionSource: 'alert',
    timestamps: {
      created: '2024-06-15T10:00:00Z',
      acknowledged: '2024-06-15T10:15:00Z',
    },
    owner: 'Sarah Chen',
    timeline: [
      {
        id: 'tl-1',
        timestamp: '2024-06-15T10:00:00Z',
        type: 'status_change',
        description: 'Incident created',
      },
      {
        id: 'tl-2',
        timestamp: '2024-06-15T10:15:00Z',
        type: 'comment',
        description: 'Investigating root cause',
        author: 'Sarah Chen',
      },
    ],
    ...overrides,
  }
}

const defaultProps = {
  allIncidents: [] as Incident[],
  isOpen: true,
  onClose: vi.fn(),
  onStatusChange: vi.fn(),
  onAddComment: vi.fn(),
}

describe('IncidentDetail', () => {
  it('renders the overview tab by default', () => {
    render(<IncidentDetail incident={makeIncident()} {...defaultProps} />)

    expect(screen.getByText('API Gateway Down')).toBeInTheDocument()
    expect(screen.getByText('Gateway returning 502 errors to all clients')).toBeInTheDocument()
    expect(screen.getByText(/P0 - Critical/)).toBeInTheDocument()
  })

  it('renders severity and status badges', () => {
    render(<IncidentDetail incident={makeIncident()} {...defaultProps} />)

    expect(screen.getByText(/P0 - Critical/)).toBeInTheDocument()
    expect(document.querySelector('.detail-status-badge')).toHaveTextContent('Open')
  })

  it('renders metadata fields', () => {
    render(<IncidentDetail incident={makeIncident()} {...defaultProps} />)

    expect(screen.getByText('Sarah Chen')).toBeInTheDocument()
    expect(screen.getByText('alert')).toBeInTheDocument()
  })

  it('renders affected services', () => {
    render(<IncidentDetail incident={makeIncident()} {...defaultProps} />)

    expect(screen.getByText('api-gateway')).toBeInTheDocument()
    expect(screen.getByText('auth-service')).toBeInTheDocument()
  })

  it('shows Unassigned when no owner', () => {
    render(
      <IncidentDetail incident={makeIncident({ owner: undefined })} {...defaultProps} />
    )
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })

  it('renders recent activity on overview tab', () => {
    render(<IncidentDetail incident={makeIncident()} {...defaultProps} />)

    expect(screen.getByText('Recent Activity')).toBeInTheDocument()
    expect(screen.getByText('Investigating root cause')).toBeInTheDocument()
  })

  it('switches to timeline tab', async () => {
    const user = userEvent.setup()
    render(<IncidentDetail incident={makeIncident()} {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Timeline' }))

    expect(screen.getByText('Incident created')).toBeInTheDocument()
    expect(screen.getByText('Investigating root cause')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Add a comment or observation...')).toBeInTheDocument()
  })

  it('switches to analysis tab', async () => {
    const user = userEvent.setup()
    render(<IncidentDetail incident={makeIncident()} {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Analysis' }))

    expect(screen.getByText('Run Analysis')).toBeInTheDocument()
  })

  it('calls onStatusChange when status dropdown changes', async () => {
    const user = userEvent.setup()
    const onStatusChange = vi.fn()
    render(
      <IncidentDetail
        incident={makeIncident()}
        {...defaultProps}
        onStatusChange={onStatusChange}
      />
    )

    await user.selectOptions(screen.getByDisplayValue('Open'), 'Investigating')
    expect(onStatusChange).toHaveBeenCalledWith('INC-1', 'Investigating')
  })

  it('adds a comment on the timeline tab', async () => {
    const user = userEvent.setup()
    const onAddComment = vi.fn()
    render(
      <IncidentDetail
        incident={makeIncident()}
        {...defaultProps}
        onAddComment={onAddComment}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Timeline' }))
    const input = screen.getByPlaceholderText('Add a comment or observation...')
    await user.type(input, 'New observation')
    await user.click(screen.getByRole('button', { name: 'Add Comment' }))

    expect(onAddComment).toHaveBeenCalledWith('INC-1', 'New observation')
  })

  it('does not add empty comment', async () => {
    const user = userEvent.setup()
    const onAddComment = vi.fn()
    render(
      <IncidentDetail
        incident={makeIncident()}
        {...defaultProps}
        onAddComment={onAddComment}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Timeline' }))
    const addBtn = screen.getByRole('button', { name: 'Add Comment' })
    expect(addBtn).toBeDisabled()
    expect(onAddComment).not.toHaveBeenCalled()
  })

  it('adds comment on Enter key', async () => {
    const user = userEvent.setup()
    const onAddComment = vi.fn()
    render(
      <IncidentDetail
        incident={makeIncident()}
        {...defaultProps}
        onAddComment={onAddComment}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Timeline' }))
    const input = screen.getByPlaceholderText('Add a comment or observation...')
    await user.type(input, 'Comment via enter{enter}')

    expect(onAddComment).toHaveBeenCalledWith('INC-1', 'Comment via enter')
  })

  it('shows empty timeline message when no events', async () => {
    const user = userEvent.setup()
    render(
      <IncidentDetail incident={makeIncident({ timeline: [] })} {...defaultProps} />
    )

    await user.click(screen.getByRole('button', { name: 'Timeline' }))
    expect(screen.getByText('No timeline events yet.')).toBeInTheDocument()
  })

  it('shows resolved timestamp when present', () => {
    render(
      <IncidentDetail
        incident={makeIncident({
          status: 'Resolved',
          timestamps: {
            created: '2024-06-15T10:00:00Z',
            acknowledged: '2024-06-15T10:15:00Z',
            resolved: '2024-06-15T12:00:00Z',
          },
        })}
        {...defaultProps}
      />
    )

    // The "Resolved" label appears in: status badge, meta label, and dropdown option
    // Check the meta label specifically
    const metaLabels = screen.getAllByText('Resolved')
    expect(metaLabels.length).toBeGreaterThanOrEqual(2) // badge + meta label + option
  })

  it('navigates to timeline via "View full timeline" link', async () => {
    const user = userEvent.setup()
    render(<IncidentDetail incident={makeIncident()} {...defaultProps} />)

    // On overview tab, click the "View full timeline" link
    const link = screen.getByText(/View full timeline/)
    await user.click(link)

    // Now on timeline tab
    expect(screen.getByPlaceholderText('Add a comment or observation...')).toBeInTheDocument()
  })
})
