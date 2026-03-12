import type { Incident, CreateIncidentInput, IncidentStatus, TimelineEvent } from '../types/incident'

// Mock in-memory database
class IncidentDatabase {
  private incidents: Map<string, Incident> = new Map()
  private nextId = 1

  // Generate unique ID
  private generateId(): string {
    return `INC-${Date.now()}-${this.nextId++}`
  }

  // Bulk-load pre-built incidents (e.g. seed data)
  seed(incidents: Incident[]): void {
    for (const inc of incidents) {
      this.incidents.set(inc.id, inc)
    }
  }

  // Create a new incident
  create(input: CreateIncidentInput): Incident {
    const id = this.generateId()
    const now = new Date().toISOString()

    const incident: Incident = {
      id,
      title: input.title,
      description: input.description,
      severity: input.severity,
      status: 'Open',
      affectedServices: input.affectedServices || [],
      detectionSource: input.detectionSource || 'manual',
      timestamps: {
        created: now,
      },
      owner: input.owner,
      timeline: [
        {
          id: `event-${Date.now()}`,
          timestamp: now,
          type: 'status_change',
          description: `Incident created: ${input.title}`,
        },
      ],
    }

    this.incidents.set(id, incident)
    return incident
  }

  // Get incident by ID
  getById(id: string): Incident | undefined {
    return this.incidents.get(id)
  }

  // Get all incidents
  getAll(): Incident[] {
    return Array.from(this.incidents.values())
  }

  // Get incidents by status
  getByStatus(status: IncidentStatus): Incident[] {
    return this.getAll().filter(incident => incident.status === status)
  }

  // Get active incidents (not resolved)
  getActive(): Incident[] {
    return this.getAll().filter(incident => incident.status !== 'Resolved')
  }

  // Update incident status
  updateStatus(id: string, newStatus: IncidentStatus, author?: string): Incident | null {
    const incident = this.incidents.get(id)
    if (!incident) return null

    const now = new Date().toISOString()
    const oldStatus = incident.status

    // Update timestamps based on status
    if (newStatus === 'Investigating' && !incident.timestamps.acknowledged) {
      incident.timestamps.acknowledged = now
    }
    if (newStatus === 'Resolved' && !incident.timestamps.resolved) {
      incident.timestamps.resolved = now
    }

    incident.status = newStatus

    // Add timeline event
    incident.timeline.push({
      id: `event-${Date.now()}`,
      timestamp: now,
      type: 'status_change',
      description: `Status changed from ${oldStatus} to ${newStatus}`,
      author,
    })

    this.incidents.set(id, incident)
    return incident
  }

  // Add timeline event
  addTimelineEvent(id: string, event: Omit<TimelineEvent, 'id' | 'timestamp'>): Incident | null {
    const incident = this.incidents.get(id)
    if (!incident) return null

    const timelineEvent: TimelineEvent = {
      id: `event-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...event,
    }

    incident.timeline.push(timelineEvent)
    this.incidents.set(id, incident)
    return incident
  }

  // Assign owner
  assignOwner(id: string, owner: string, author?: string): Incident | null {
    const incident = this.incidents.get(id)
    if (!incident) return null

    incident.owner = owner

    incident.timeline.push({
      id: `event-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'assignment',
      description: `Assigned to ${owner}`,
      author,
    })

    this.incidents.set(id, incident)
    return incident
  }

  // Update incident
  update(id: string, updates: Partial<Incident>): Incident | null {
    const incident = this.incidents.get(id)
    if (!incident) return null

    const updated = { ...incident, ...updates }
    this.incidents.set(id, updated)
    return updated
  }

  // Delete incident (soft delete by marking as resolved, or hard delete)
  delete(id: string, hardDelete = false): boolean {
    if (hardDelete) {
      return this.incidents.delete(id)
    } else {
      // Soft delete - mark as resolved
      const incident = this.updateStatus(id, 'Resolved')
      return incident !== null
    }
  }

  // Get statistics
  getStats() {
    const all = this.getAll()
    return {
      total: all.length,
      active: this.getActive().length,
      byStatus: {
        Open: all.filter(i => i.status === 'Open').length,
        Investigating: all.filter(i => i.status === 'Investigating').length,
        Mitigated: all.filter(i => i.status === 'Mitigated').length,
        Resolved: all.filter(i => i.status === 'Resolved').length,
      },
      bySeverity: {
        P0: all.filter(i => i.severity === 'P0').length,
        P1: all.filter(i => i.severity === 'P1').length,
        P2: all.filter(i => i.severity === 'P2').length,
        P3: all.filter(i => i.severity === 'P3').length,
        P4: all.filter(i => i.severity === 'P4').length,
      },
    }
  }
}

// Export singleton instance
export const incidentDatabase = new IncidentDatabase()
