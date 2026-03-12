export type IncidentSeverity = 'P0' | 'P1' | 'P2' | 'P3' | 'P4'
export type IncidentStatus = 'Open' | 'Investigating' | 'Mitigated' | 'Resolved'
export type DetectionSource = 'manual' | 'alert' | 'copilot' | 'integration'

export interface Incident {
  id: string
  title: string
  description: string
  severity: IncidentSeverity
  status: IncidentStatus
  affectedServices: string[]
  detectionSource: DetectionSource
  timestamps: {
    created: string
    acknowledged?: string
    resolved?: string
  }
  owner?: string
  onCallResponder?: string
  timeline: TimelineEvent[]
}

export interface TimelineEvent {
  id: string
  timestamp: string
  type: 'status_change' | 'comment' | 'assignment' | 'mitigation' | 'resolution'
  description: string
  author?: string
}

export interface CreateIncidentInput {
  title: string
  description: string
  severity: IncidentSeverity
  affectedServices?: string[]
  detectionSource?: DetectionSource
  owner?: string
}
