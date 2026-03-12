import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatIncidentForm, emptyFormData } from '../ChatIncidentForm'
import type { IncidentFormData } from '../ChatIncidentForm'
import type { Incident } from '../../types/incident'

function renderForm(overrides: {
  formData?: Partial<IncidentFormData>
  mode?: 'editing' | 'review' | 'submitted'
  onSubmit?: (incident: Incident) => void
  onFormDataChange?: (data: IncidentFormData) => void
  onModeChange?: (mode: 'editing' | 'review' | 'submitted') => void
  errors?: Record<string, string>
  onErrorsChange?: (errors: Record<string, string>) => void
} = {}) {
  const props = {
    formData: { ...emptyFormData, ...overrides.formData },
    onFormDataChange: overrides.onFormDataChange ?? vi.fn<(data: IncidentFormData) => void>(),
    mode: overrides.mode ?? 'editing' as const,
    onModeChange: overrides.onModeChange ?? vi.fn<(mode: 'editing' | 'review' | 'submitted') => void>(),
    onSubmit: overrides.onSubmit ?? vi.fn<(incident: Incident) => void>(),
    errors: overrides.errors ?? {},
    onErrorsChange: overrides.onErrorsChange ?? vi.fn<(errors: Record<string, string>) => void>(),
  }
  return { ...render(<ChatIncidentForm {...props} />), props }
}

describe('ChatIncidentForm', () => {
  it('renders the form with empty fields in editing mode', () => {
    renderForm()

    expect(screen.getByText('Report Incident', { selector: '.chat-form-title' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/API endpoint/)).toHaveValue('')
    expect(screen.getByPlaceholderText(/Describe the incident/)).toHaveValue('')
  })

  it('renders pre-filled fields from formData', () => {
    renderForm({
      formData: {
        title: 'API Gateway Down',
        description: 'Gateway returning 502 errors',
        affectedSystems: 'API Gateway, Auth Service',
        assignee: 'Platform Team',
      },
    })

    expect(screen.getByPlaceholderText(/API endpoint/)).toHaveValue('API Gateway Down')
    expect(screen.getByPlaceholderText(/Describe the incident/)).toHaveValue('Gateway returning 502 errors')
    expect(screen.getByPlaceholderText(/API Gateway, Auth Service/)).toHaveValue('API Gateway, Auth Service')
    expect(screen.getByPlaceholderText(/Team member/)).toHaveValue('Platform Team')
  })

  it('shows review banner and confirm button in review mode', () => {
    renderForm({ mode: 'review', formData: { title: 'Test' } })

    expect(screen.getByText('Review Incident', { selector: '.chat-form-title' })).toBeInTheDocument()
    expect(screen.getByText('AI completed')).toBeInTheDocument()
    expect(screen.getByText(/Is this information correct/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirm & Report/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument()
  })

  it('does not show review banner in editing mode', () => {
    renderForm()

    expect(screen.queryByText(/Is this information correct/)).not.toBeInTheDocument()
    expect(screen.queryByText('AI completed')).not.toBeInTheDocument()
  })

  it('shows validation errors when passed', () => {
    renderForm({
      errors: { title: 'Title is required', description: 'Description is required' },
    })

    expect(screen.getByText('Title is required')).toBeInTheDocument()
    expect(screen.getByText('Description is required')).toBeInTheDocument()
  })

  it('calls onFormDataChange when user types', async () => {
    const user = userEvent.setup()
    const onFormDataChange = vi.fn()
    renderForm({ onFormDataChange })

    await user.type(screen.getByPlaceholderText(/API endpoint/), 'A')

    expect(onFormDataChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'A' })
    )
  })

  it('clears field error when user types in that field', async () => {
    const user = userEvent.setup()
    const onErrorsChange = vi.fn()
    renderForm({
      errors: { title: 'Title is required' },
      onErrorsChange,
    })

    await user.type(screen.getByPlaceholderText(/API endpoint/), 'A')

    expect(onErrorsChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: '' })
    )
  })

  it('validates required fields on submit in editing mode', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onErrorsChange = vi.fn()
    renderForm({ onSubmit, onErrorsChange })

    await user.click(screen.getByRole('button', { name: /Report Incident/i }))

    expect(onErrorsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Title is required',
        description: 'Description is required',
      })
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('submits incident with correct data in editing mode', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onModeChange = vi.fn()
    renderForm({
      formData: {
        title: 'DB Connection Pool Exhausted',
        description: 'PostgreSQL connections maxed out',
        severity: 'P1',
        type: 'performance',
        affectedSystems: 'Database, API',
        assignee: 'DBA Team',
      },
      onSubmit,
      onModeChange,
    })

    await user.click(screen.getByRole('button', { name: /Report Incident/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const incident: Incident = onSubmit.mock.calls[0][0]

    expect(incident.title).toBe('DB Connection Pool Exhausted')
    expect(incident.description).toBe('PostgreSQL connections maxed out')
    expect(incident.severity).toBe('P1')
    expect(incident.status).toBe('Open')
    expect(incident.affectedServices).toEqual(['Database', 'API'])
    expect(incident.owner).toBe('DBA Team')
    expect(incident.detectionSource).toBe('copilot')
    expect(incident.id).toBeTruthy()
    expect(incident.timestamps.created).toBeTruthy()
    expect(onModeChange).toHaveBeenCalledWith('submitted')
  })

  it('submits incident on confirm in review mode', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onModeChange = vi.fn()
    renderForm({
      mode: 'review',
      formData: {
        title: 'API Breach',
        description: 'Unauthorized access detected',
        severity: 'P0',
        type: 'security',
        affectedSystems: 'API Gateway',
        assignee: 'Security Team',
      },
      onSubmit,
      onModeChange,
    })

    await user.click(screen.getByRole('button', { name: /Confirm & Report/i }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const incident: Incident = onSubmit.mock.calls[0][0]
    expect(incident.title).toBe('API Breach')
    expect(incident.severity).toBe('P0')
    expect(onModeChange).toHaveBeenCalledWith('submitted')
  })

  it('switches to editing mode when Edit button clicked in review', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    renderForm({ mode: 'review', formData: { title: 'Test' }, onModeChange })

    await user.click(screen.getByRole('button', { name: /Edit/i }))

    expect(onModeChange).toHaveBeenCalledWith('editing')
  })

  it('shows success state in submitted mode', () => {
    renderForm({
      mode: 'submitted',
      formData: { title: 'Test Incident', severity: 'P1' },
    })

    expect(screen.getByText('Incident Reported')).toBeInTheDocument()
    expect(screen.getByText(/Test Incident/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/API endpoint/)).not.toBeInTheDocument()
  })

  it('defaults severity to P2 when not provided', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({
      formData: { title: 'Test', description: 'Desc' },
      onSubmit,
    })

    await user.click(screen.getByRole('button', { name: /Report Incident/i }))

    const incident: Incident = onSubmit.mock.calls[0][0]
    expect(incident.severity).toBe('P2')
  })

  it('handles empty affectedSystems gracefully', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm({
      formData: { title: 'Test', description: 'Desc', affectedSystems: '' },
      onSubmit,
    })

    await user.click(screen.getByRole('button', { name: /Report Incident/i }))

    const incident: Incident = onSubmit.mock.calls[0][0]
    expect(incident.affectedServices).toEqual([])
  })

  it('applies ai-filled class to all fields in review mode', () => {
    renderForm({
      mode: 'review',
      formData: { title: 'Prefilled', description: 'Desc' },
    })

    const titleInput = screen.getByPlaceholderText(/API endpoint/)
    expect(titleInput.className).toContain('ai-filled')

    const descInput = screen.getByPlaceholderText(/Describe the incident/)
    expect(descInput.className).toContain('ai-filled')
  })

  it('does not apply ai-filled class in editing mode', () => {
    renderForm({
      formData: { title: 'Prefilled', description: '' },
    })

    const titleInput = screen.getByPlaceholderText(/API endpoint/)
    expect(titleInput.className).not.toContain('ai-filled')
  })
})
