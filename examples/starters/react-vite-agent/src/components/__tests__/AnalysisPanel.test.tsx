import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AnalysisPanel } from '../AnalysisPanel'
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
    timestamps: { created: '2024-06-15T10:00:00Z' },
    owner: 'Sarah Chen',
    timeline: [],
    ...overrides,
  }
}

describe('AnalysisPanel', () => {
  it('shows the "Run Analysis" button initially', () => {
    render(<AnalysisPanel incident={makeIncident()} allIncidents={[]} />)

    expect(screen.getByText('Run Analysis')).toBeInTheDocument()
    expect(screen.getByText(/Run a security analysis/)).toBeInTheDocument()
  })

  it('shows loading state after clicking Run Analysis', async () => {
    const user = userEvent.setup()
    vi.useFakeTimers({ shouldAdvanceTime: true })

    render(<AnalysisPanel incident={makeIncident()} allIncidents={[]} />)
    await user.click(screen.getByText('Run Analysis'))

    expect(screen.getByText('Analyzing incident...')).toBeInTheDocument()

    // Advance past the 400ms delay
    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    vi.useRealTimers()
  })

  it('shows analysis results after loading completes', async () => {
    const user = userEvent.setup()
    vi.useFakeTimers({ shouldAdvanceTime: true })

    render(<AnalysisPanel incident={makeIncident()} allIncidents={[makeIncident()]} />)
    await user.click(screen.getByText('Run Analysis'))

    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    // Should show analysis sections
    expect(screen.getByText('Risk Score')).toBeInTheDocument()
    expect(screen.getByText('Security Logs')).toBeInTheDocument()
    expect(screen.getByText('Affected Assets')).toBeInTheDocument()
    expect(screen.getByText('Related Incidents')).toBeInTheDocument()
    expect(screen.getByText('Recommended Runbooks')).toBeInTheDocument()

    vi.useRealTimers()
  })

  it('renders risk score as a number', async () => {
    const user = userEvent.setup()
    vi.useFakeTimers({ shouldAdvanceTime: true })

    render(<AnalysisPanel incident={makeIncident()} allIncidents={[]} />)
    await user.click(screen.getByText('Run Analysis'))

    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    // Risk score should be a number between 0-100
    const riskBadge = document.querySelector('.risk-badge')
    expect(riskBadge).toBeTruthy()
    const score = parseInt(riskBadge!.textContent || '0')
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)

    vi.useRealTimers()
  })

  it('renders security logs table', async () => {
    const user = userEvent.setup()
    vi.useFakeTimers({ shouldAdvanceTime: true })

    render(<AnalysisPanel incident={makeIncident()} allIncidents={[]} />)
    await user.click(screen.getByText('Run Analysis'))

    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    // Should have table headers
    expect(screen.getByText('Time')).toBeInTheDocument()
    expect(screen.getByText('Source')).toBeInTheDocument()
    expect(screen.getByText('Message')).toBeInTheDocument()

    vi.useRealTimers()
  })

  it('expands runbook steps on click', async () => {
    const user = userEvent.setup()
    vi.useFakeTimers({ shouldAdvanceTime: true })

    render(<AnalysisPanel incident={makeIncident()} allIncidents={[]} />)
    await user.click(screen.getByText('Run Analysis'))

    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    // Find and click first runbook
    const runbookHeaders = document.querySelectorAll('.runbook-header')
    expect(runbookHeaders.length).toBeGreaterThan(0)

    await user.click(runbookHeaders[0])

    // Steps should now be visible (ol > li elements)
    const steps = document.querySelectorAll('.runbook-steps li')
    expect(steps.length).toBeGreaterThan(0)

    vi.useRealTimers()
  })
})
