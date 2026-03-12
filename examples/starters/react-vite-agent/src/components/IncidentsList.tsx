import type { Incident } from '../types/incident'
import './IncidentsList.css'

interface IncidentsListProps {
  incidents: Incident[]
  onIncidentClick?: (incident: Incident) => void
}

export function IncidentsList({ incidents, onIncidentClick }: IncidentsListProps) {
  if (incidents.length === 0) {
    return (
      <div className="incidents-list-empty">
        <p>No incidents match your filters.</p>
      </div>
    )
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'P0': return '#ef4444'
      case 'P1': return '#f97316'
      case 'P2': return '#eab308'
      case 'P3': return '#3b82f6'
      case 'P4': return '#6b7280'
      default: return '#6b7280'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Open': return '#ef4444'
      case 'Investigating': return '#f97316'
      case 'Mitigated': return '#3b82f6'
      case 'Resolved': return '#10b981'
      default: return '#6b7280'
    }
  }

  return (
    <div className="incidents-list">
      <div className="incidents-list-items">
        {incidents.map((incident) => (
          <div
            key={incident.id}
            className="incident-item"
            onClick={() => onIncidentClick?.(incident)}
          >
            <div className="incident-item-header">
              <div className="incident-severity" style={{ backgroundColor: getSeverityColor(incident.severity) }}>
                {incident.severity}
              </div>
              <h4 className="incident-title">{incident.title}</h4>
              <div className="incident-status" style={{ color: getStatusColor(incident.status) }}>
                {incident.status}
              </div>
            </div>
            <p className="incident-description">{incident.description}</p>
            <div className="incident-meta">
              {incident.affectedServices.length > 0 && (
                <span className="incident-services">
                  {incident.affectedServices.join(', ')}
                </span>
              )}
              {incident.owner && (
                <span className="incident-owner">Owner: {incident.owner}</span>
              )}
              <span className="incident-time">
                {new Date(incident.timestamps.created).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
