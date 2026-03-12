import { type FormEvent } from 'react'
import type { Incident, IncidentSeverity } from '../types/incident'
import './ChatIncidentForm.css'

export interface IncidentFormData {
  title: string
  description: string
  severity: string
  type: string
  affectedSystems: string
  assignee: string
}

export const emptyFormData: IncidentFormData = {
  title: '',
  description: '',
  severity: 'P2',
  type: 'other',
  affectedSystems: '',
  assignee: '',
}

interface ChatIncidentFormProps {
  formData: IncidentFormData
  onFormDataChange: (data: IncidentFormData) => void
  mode: 'editing' | 'review' | 'submitted'
  onModeChange: (mode: 'editing' | 'review' | 'submitted') => void
  onSubmit: (incident: Incident) => void
  errors: Record<string, string>
  onErrorsChange: (errors: Record<string, string>) => void
}

const severityMap: Record<string, IncidentSeverity> = {
  critical: 'P0',
  high: 'P1',
  medium: 'P2',
  low: 'P3',
  info: 'P4',
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
  P4: 'P4',
}

export function ChatIncidentForm({
  formData,
  onFormDataChange,
  mode,
  onModeChange,
  onSubmit,
  errors,
  onErrorsChange,
}: ChatIncidentFormProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    onFormDataChange({ ...formData, [name]: value })
    if (errors[name]) {
      onErrorsChange({ ...errors, [name]: '' })
    }
  }

  const buildIncident = (): Incident | null => {
    const newErrors: Record<string, string> = {}
    if (!formData.title.trim()) newErrors.title = 'Title is required'
    if (!formData.description.trim()) newErrors.description = 'Description is required'
    if (Object.keys(newErrors).length > 0) {
      onErrorsChange(newErrors)
      return null
    }

    const now = new Date().toISOString()
    const sev = severityMap[formData.severity] || 'P2'
    const affectedServices = formData.affectedSystems
      ? formData.affectedSystems.split(',').map(s => s.trim()).filter(Boolean)
      : []

    return {
      id: crypto.randomUUID(),
      title: formData.title,
      description: formData.description,
      severity: sev,
      status: 'Open',
      affectedServices,
      detectionSource: 'copilot',
      timestamps: { created: now },
      owner: formData.assignee || undefined,
      timeline: [],
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const incident = buildIncident()
    if (!incident) return
    onSubmit(incident)
    onModeChange('submitted')
  }

  const handleConfirm = () => {
    const incident = buildIncident()
    if (!incident) return
    onSubmit(incident)
    onModeChange('submitted')
  }

  if (mode === 'submitted') {
    return (
      <div className="chat-form-success">
        <div className="chat-form-success-icon">&#10003;</div>
        <div>
          <strong>Incident Reported</strong>
          <p>{formData.title} — {severityMap[formData.severity] || formData.severity}</p>
        </div>
      </div>
    )
  }

  const isReview = mode === 'review'

  return (
    <form className="chat-incident-form" onSubmit={handleSubmit}>
      <div className="chat-form-header">
        <span className="chat-form-icon">&#9888;</span>
        <span className="chat-form-title">
          {isReview ? 'Review Incident' : 'Report Incident'}
        </span>
        {isReview && (
          <span className="chat-form-ai-badge">AI completed</span>
        )}
      </div>

      {isReview && (
        <div className="chat-form-review-banner">
          Is this information correct? Review the details below, edit if needed, then confirm.
        </div>
      )}

      <div className="chat-form-field">
        <label className="chat-form-label">
          Title <span className="chat-form-required">*</span>
        </label>
        <input
          type="text"
          name="title"
          value={formData.title}
          onChange={handleChange}
          className={`chat-form-input ${errors.title ? 'chat-form-input-error' : ''} ${isReview ? 'ai-filled' : ''}`}
          placeholder="e.g., API endpoint returning 500 errors"
        />
        {errors.title && <span className="chat-form-error">{errors.title}</span>}
      </div>

      <div className="chat-form-field">
        <label className="chat-form-label">
          Description <span className="chat-form-required">*</span>
        </label>
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          className={`chat-form-textarea ${errors.description ? 'chat-form-input-error' : ''} ${isReview ? 'ai-filled' : ''}`}
          placeholder="Describe the incident..."
          rows={3}
        />
        {errors.description && <span className="chat-form-error">{errors.description}</span>}
      </div>

      <div className="chat-form-row">
        <div className="chat-form-field">
          <label className="chat-form-label">Severity</label>
          <select
            name="severity"
            value={formData.severity}
            onChange={handleChange}
            className={`chat-form-select ${isReview ? 'ai-filled' : ''}`}
          >
            <option value="P0">P0 — Critical</option>
            <option value="P1">P1 — High</option>
            <option value="P2">P2 — Medium</option>
            <option value="P3">P3 — Low</option>
            <option value="P4">P4 — Info</option>
          </select>
        </div>

        <div className="chat-form-field">
          <label className="chat-form-label">Type</label>
          <select
            name="type"
            value={formData.type}
            onChange={handleChange}
            className={`chat-form-select ${isReview ? 'ai-filled' : ''}`}
          >
            <option value="security">Security</option>
            <option value="performance">Performance</option>
            <option value="availability">Availability</option>
            <option value="data">Data</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div className="chat-form-field">
        <label className="chat-form-label">Affected Systems</label>
        <input
          type="text"
          name="affectedSystems"
          value={formData.affectedSystems}
          onChange={handleChange}
          className={`chat-form-input ${isReview ? 'ai-filled' : ''}`}
          placeholder="e.g., API Gateway, Auth Service (comma-separated)"
        />
      </div>

      <div className="chat-form-field">
        <label className="chat-form-label">Assignee</label>
        <input
          type="text"
          name="assignee"
          value={formData.assignee}
          onChange={handleChange}
          className={`chat-form-input ${isReview ? 'ai-filled' : ''}`}
          placeholder="Team member or team name"
        />
      </div>

      <div className="chat-form-actions">
        {isReview ? (
          <>
            <button
              type="button"
              className="chat-form-edit-btn"
              onClick={() => onModeChange('editing')}
            >
              Edit
            </button>
            <button
              type="button"
              className="chat-form-confirm-btn"
              onClick={handleConfirm}
            >
              Confirm &amp; Report
            </button>
          </>
        ) : (
          <button type="submit" className="chat-form-submit">
            Report Incident
          </button>
        )}
      </div>
    </form>
  )
}
