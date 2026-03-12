import { useState } from 'react'
import { Modal } from './Modal'
import { AnalysisPanel } from './AnalysisPanel'
import type { Incident, IncidentStatus, TimelineEvent } from '../types/incident'
import './IncidentDetail.css'

interface IncidentDetailProps {
  incident: Incident
  allIncidents: Incident[]
  isOpen: boolean
  onClose: () => void
  onStatusChange: (incidentId: string, newStatus: IncidentStatus) => void
  onAddComment: (incidentId: string, comment: string) => void
}

const severityColors: Record<string, string> = {
  P0: '#ef4444',
  P1: '#f97316',
  P2: '#eab308',
  P3: '#3b82f6',
  P4: '#6b7280',
}

const severityLabels: Record<string, string> = {
  P0: 'Critical',
  P1: 'High',
  P2: 'Medium',
  P3: 'Low',
  P4: 'Info',
}

const statusColors: Record<string, string> = {
  Open: '#ef4444',
  Investigating: '#f97316',
  Mitigated: '#3b82f6',
  Resolved: '#10b981',
}

const allStatuses: IncidentStatus[] = ['Open', 'Investigating', 'Mitigated', 'Resolved']

const timelineIcons: Record<TimelineEvent['type'], string> = {
  status_change: '\u2194',
  comment: '\u{1F4AC}',
  assignment: '\u{1F464}',
  mitigation: '\u{1F6E1}',
  resolution: '\u2713',
}

const serviceIcons: Record<string, string> = {
  api: '\u{1F310}',
  database: '\u{1F5C4}',
  auth: '\u{1F512}',
  cdn: '\u{26A1}',
  default: '\u{2699}',
}

function getServiceIcon(name: string): string {
  const lower = name.toLowerCase()
  for (const [key, icon] of Object.entries(serviceIcons)) {
    if (key !== 'default' && lower.includes(key)) return icon
  }
  return serviceIcons.default
}

function formatTimestamp(ts: string) {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function relativeTime(ts: string): string {
  const now = Date.now()
  const then = new Date(ts).getTime()
  const diffMs = now - then
  if (diffMs < 0) return 'just now'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function IncidentDetail({
  incident,
  allIncidents,
  isOpen,
  onClose,
  onStatusChange,
  onAddComment,
}: IncidentDetailProps) {
  const [commentText, setCommentText] = useState('')
  const [activeTab, setActiveTab] = useState<'overview' | 'timeline' | 'analysis'>('overview')

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onStatusChange(incident.id, e.target.value as IncidentStatus)
  }

  const handleAddComment = () => {
    const trimmed = commentText.trim()
    if (!trimmed) return
    onAddComment(incident.id, trimmed)
    setCommentText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAddComment()
    }
  }

  const sortedTimeline = [...incident.timeline].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )

  const recentEvents = sortedTimeline.slice(-3).reverse()

  const renderTimeline = () => (
    <div className="incident-timeline">
      <h4 className="timeline-title">Timeline</h4>
      {sortedTimeline.length === 0 ? (
        <div className="timeline-empty">No timeline events yet.</div>
      ) : (
        <div className="timeline-events">
          {sortedTimeline.map((event) => (
            <div key={event.id} className="timeline-event">
              <div className={`timeline-dot ${event.type}`}>
                {timelineIcons[event.type]}
              </div>
              <div className="timeline-event-content">
                <div className="timeline-event-header">
                  <span className="timeline-event-type">
                    {event.type.replace('_', ' ')}
                  </span>
                  <span className="timeline-event-time">
                    {formatTimestamp(event.timestamp)}
                  </span>
                  <span className="meta-relative">{relativeTime(event.timestamp)}</span>
                  {event.author && (
                    <span className="timeline-event-author">by {event.author}</span>
                  )}
                </div>
                <p className="timeline-event-description">{event.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add comment */}
      <div className="add-comment-section">
        <input
          type="text"
          className="comment-input"
          placeholder="Add a comment or observation..."
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="btn-add-comment"
          onClick={handleAddComment}
          disabled={!commentText.trim()}
        >
          Add Comment
        </button>
      </div>
    </div>
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Incident Details">
      <div className="incident-detail">
        {/* Tab bar */}
        <div className="detail-tabs">
          <button
            className={`detail-tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`detail-tab ${activeTab === 'timeline' ? 'active' : ''}`}
            onClick={() => setActiveTab('timeline')}
          >
            Timeline
          </button>
          <button
            className={`detail-tab ${activeTab === 'analysis' ? 'active' : ''}`}
            onClick={() => setActiveTab('analysis')}
          >
            Analysis
          </button>
        </div>

        {activeTab === 'analysis' ? (
          <AnalysisPanel incident={incident} allIncidents={allIncidents} />
        ) : activeTab === 'timeline' ? (
          renderTimeline()
        ) : (
        <>
        {/* Header */}
        <div className="incident-detail-header">
          <div className="incident-detail-badges">
            <span
              className="detail-severity-badge"
              style={{ backgroundColor: severityColors[incident.severity] }}
            >
              {incident.severity} - {severityLabels[incident.severity] ?? incident.severity}
            </span>
            <span
              className="detail-status-badge"
              style={{
                color: statusColors[incident.status],
                borderColor: statusColors[incident.status],
              }}
            >
              {incident.status}
            </span>
          </div>
          <h3 className="incident-detail-title">{incident.title}</h3>
          <p className="incident-detail-description">{incident.description}</p>
        </div>

        {/* Metadata */}
        <div className="incident-detail-meta">
          <div className="meta-item">
            <span className="meta-label">Owner</span>
            <span className="meta-value">{incident.owner || 'Unassigned'}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Detection</span>
            <span className="meta-value">{incident.detectionSource}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Created</span>
            <span className="meta-value">{formatTimestamp(incident.timestamps.created)}</span>
            <span className="meta-relative">{relativeTime(incident.timestamps.created)}</span>
          </div>
          {incident.timestamps.acknowledged && (
            <div className="meta-item">
              <span className="meta-label">Acknowledged</span>
              <span className="meta-value">{formatTimestamp(incident.timestamps.acknowledged)}</span>
              <span className="meta-relative">{relativeTime(incident.timestamps.acknowledged)}</span>
            </div>
          )}
          {incident.timestamps.resolved && (
            <div className="meta-item">
              <span className="meta-label">Resolved</span>
              <span className="meta-value">{formatTimestamp(incident.timestamps.resolved)}</span>
              <span className="meta-relative">{relativeTime(incident.timestamps.resolved)}</span>
            </div>
          )}
          {incident.affectedServices.length > 0 && (
            <div className="meta-item" style={{ gridColumn: '1 / -1' }}>
              <span className="meta-label">Affected Systems</span>
              <div className="affected-services-list">
                {incident.affectedServices.map((s) => (
                  <div key={s} className="service-card">
                    <span className="service-card-icon">{getServiceIcon(s)}</span>
                    <span className="service-card-name">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Status change */}
        <div className="incident-detail-actions">
          <span className="status-change-label">Change Status:</span>
          <select
            className="status-select"
            value={incident.status}
            onChange={handleStatusChange}
          >
            {allStatuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Recent Activity */}
        {recentEvents.length > 0 && (
          <div className="recent-activity">
            <h4 className="timeline-title">Recent Activity</h4>
            <div className="timeline-events">
              {recentEvents.map((event) => (
                <div key={event.id} className="timeline-event">
                  <div className={`timeline-dot ${event.type}`}>
                    {timelineIcons[event.type]}
                  </div>
                  <div className="timeline-event-content">
                    <div className="timeline-event-header">
                      <span className="timeline-event-type">
                        {event.type.replace('_', ' ')}
                      </span>
                      <span className="timeline-event-time">
                        {formatTimestamp(event.timestamp)}
                      </span>
                      <span className="meta-relative">{relativeTime(event.timestamp)}</span>
                    </div>
                    <p className="timeline-event-description">{event.description}</p>
                  </div>
                </div>
              ))}
            </div>
            <button
              className="recent-activity-link"
              onClick={() => setActiveTab('timeline')}
            >
              View full timeline &rarr;
            </button>
          </div>
        )}
        </>
        )}
      </div>
    </Modal>
  )
}
