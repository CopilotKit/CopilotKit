import { useState, useMemo } from 'react'
import type { Incident, TimelineEvent } from '../types/incident'
import './CrossIncidentTimeline.css'

interface CrossIncidentTimelineProps {
  incidents: Incident[]
  onIncidentClick: (incident: Incident) => void
}

interface AggregatedEvent {
  event: TimelineEvent
  incident: Incident
}

const timelineDotColors: Record<TimelineEvent['type'], string> = {
  status_change: '#6366f1',
  comment: '#3b82f6',
  assignment: '#a855f7',
  mitigation: '#eab308',
  resolution: '#10b981',
}

const timelineIcons: Record<TimelineEvent['type'], string> = {
  status_change: '\u2194',
  comment: '\u{1F4AC}',
  assignment: '\u{1F464}',
  mitigation: '\u{1F6E1}',
  resolution: '\u2713',
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

const DEFAULT_MAX = 20

export function CrossIncidentTimeline({ incidents, onIncidentClick }: CrossIncidentTimelineProps) {
  const [showAll, setShowAll] = useState(false)

  const allEvents = useMemo<AggregatedEvent[]>(() => {
    const events: AggregatedEvent[] = []
    for (const incident of incidents) {
      for (const event of incident.timeline) {
        events.push({ event, incident })
      }
    }
    events.sort((a, b) => new Date(b.event.timestamp).getTime() - new Date(a.event.timestamp).getTime())
    return events
  }, [incidents])

  if (allEvents.length === 0) {
    return <div className="cross-timeline-empty">No activity yet. Report an incident to get started.</div>
  }

  const displayEvents = showAll ? allEvents : allEvents.slice(0, DEFAULT_MAX)

  return (
    <div className="cross-timeline">
      <div className="cross-timeline-events">
        {displayEvents.map(({ event, incident }) => (
          <div key={event.id} className="cross-timeline-event">
            <div
              className="cross-timeline-dot"
              style={{ backgroundColor: `${timelineDotColors[event.type]}22`, color: timelineDotColors[event.type] }}
            >
              {timelineIcons[event.type]}
            </div>
            <div className="cross-timeline-content">
              <div className="cross-timeline-header">
                <button
                  className="cross-timeline-incident-link"
                  onClick={() => onIncidentClick(incident)}
                >
                  {incident.title}
                </button>
                <span className="cross-timeline-time">{relativeTime(event.timestamp)}</span>
              </div>
              <p className="cross-timeline-description">
                <span className="cross-timeline-type">{event.type.replace('_', ' ')}</span>
                {event.author && <span className="cross-timeline-author"> by {event.author}</span>}
                {' \u2014 '}{event.description}
              </p>
            </div>
          </div>
        ))}
      </div>
      {!showAll && allEvents.length > DEFAULT_MAX && (
        <button className="cross-timeline-show-all" onClick={() => setShowAll(true)}>
          Show all {allEvents.length} events
        </button>
      )}
    </div>
  )
}
