import { useState, type FormEvent } from 'react'
import { Modal } from './Modal'
import './IncidentForm.css'

interface IncidentFormProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (incident: IncidentData) => void
}

export interface IncidentData {
  title: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  type: 'security' | 'performance' | 'availability' | 'data' | 'other'
  assignee?: string
  affectedSystems?: string
  initialObservations?: string
}

export function IncidentForm({ isOpen, onClose, onSubmit }: IncidentFormProps) {
  const initialFormData: IncidentData = {
    title: '',
    description: '',
    severity: 'medium',
    type: 'other',
    assignee: '',
    affectedSystems: '',
    initialObservations: '',
  }
  const [formData, setFormData] = useState<IncidentData>(initialFormData)
  const [errors, setErrors] = useState<Partial<Record<keyof IncidentData, string>>>({})

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    // Clear error when user starts typing
    if (errors[name as keyof IncidentData]) {
      setErrors(prev => ({ ...prev, [name]: undefined }))
    }
  }

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof IncidentData, string>> = {}
    
    if (!formData.title.trim()) {
      newErrors.title = 'Title is required'
    }
    
    if (!formData.description.trim()) {
      newErrors.description = 'Description is required'
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    
    if (!validate()) {
      return
    }

    onSubmit(formData)
    
    // Reset form
    setFormData(initialFormData)
    setErrors({})
    onClose()
  }

  const handleCancel = () => {
    setFormData(initialFormData)
    setErrors({})
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title="Report New Incident">
      <form className="incident-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="title" className="form-label">
            Incident Title <span className="required">*</span>
          </label>
          <input
            type="text"
            id="title"
            name="title"
            value={formData.title}
            onChange={handleChange}
            className={`form-input ${errors.title ? 'form-input-error' : ''}`}
            placeholder="e.g., API endpoint returning 500 errors"
            required
          />
          {errors.title && <span className="form-error">{errors.title}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="description" className="form-label">
            Description <span className="required">*</span>
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            className={`form-textarea ${errors.description ? 'form-input-error' : ''}`}
            placeholder="Provide detailed information about the incident..."
            rows={4}
            required
          />
          {errors.description && <span className="form-error">{errors.description}</span>}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="severity" className="form-label">
              Severity <span className="required">*</span>
            </label>
            <select
              id="severity"
              name="severity"
              value={formData.severity}
              onChange={handleChange}
              className="form-select"
              required
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="type" className="form-label">
              Type <span className="required">*</span>
            </label>
            <select
              id="type"
              name="type"
              value={formData.type}
              onChange={handleChange}
              className="form-select"
              required
            >
              <option value="security">Security</option>
              <option value="performance">Performance</option>
              <option value="availability">Availability</option>
              <option value="data">Data</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="affectedSystems" className="form-label">
            Affected Systems
          </label>
          <input
            type="text"
            id="affectedSystems"
            name="affectedSystems"
            value={formData.affectedSystems}
            onChange={handleChange}
            className="form-input"
            placeholder="e.g., API Gateway, Auth Service, Database (comma-separated)"
          />
          <span className="form-hint">Comma-separated list of affected services or systems</span>
        </div>

        <div className="form-group">
          <label htmlFor="initialObservations" className="form-label">
            Initial Observations
          </label>
          <textarea
            id="initialObservations"
            name="initialObservations"
            value={formData.initialObservations}
            onChange={handleChange}
            className="form-textarea"
            placeholder="What have you observed so far? Any error messages, patterns, or impact details..."
            rows={3}
          />
        </div>

        <div className="form-group">
          <label htmlFor="assignee" className="form-label">
            Assignee (Optional)
          </label>
          <input
            type="text"
            id="assignee"
            name="assignee"
            value={formData.assignee}
            onChange={handleChange}
            className="form-input"
            placeholder="Team member or team name"
          />
        </div>

        <div className="form-actions">
          <button type="button" className="btn-cancel" onClick={handleCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-submit">
            Report Incident
          </button>
        </div>
      </form>
    </Modal>
  )
}
