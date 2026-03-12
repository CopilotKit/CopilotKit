import { describe, it, expect, beforeEach } from 'vitest'
import type { Incident } from '../../types/incident'

// We need a fresh database instance per test, so we'll create the class directly
// The module exports a singleton, so we'll re-import to get fresh state
describe('IncidentDatabase', () => {
  // Use dynamic import to get a fresh module each test
  let incidentDatabase: typeof import('../../services/incidentDatabase')['incidentDatabase']

  beforeEach(async () => {
    // Reset modules to get a fresh singleton
    const mod = await import('../../services/incidentDatabase')
    incidentDatabase = mod.incidentDatabase
    // Clear all incidents by seeding with empty array (hack: use the internal map via seed)
    // Actually, we'll just work with whatever state exists and create fresh incidents
  })

  it('creates an incident with correct defaults', () => {
    const incident = incidentDatabase.create({
      title: 'Test Incident',
      description: 'Something broke',
      severity: 'P1',
    })

    expect(incident.id).toBeTruthy()
    expect(incident.title).toBe('Test Incident')
    expect(incident.description).toBe('Something broke')
    expect(incident.severity).toBe('P1')
    expect(incident.status).toBe('Open')
    expect(incident.affectedServices).toEqual([])
    expect(incident.detectionSource).toBe('manual')
    expect(incident.timestamps.created).toBeTruthy()
    expect(incident.timeline).toHaveLength(1)
    expect(incident.timeline[0].type).toBe('status_change')
  })

  it('creates an incident with all fields', () => {
    const incident = incidentDatabase.create({
      title: 'Full Incident',
      description: 'Details here',
      severity: 'P0',
      affectedServices: ['api-gateway', 'auth-service'],
      detectionSource: 'alert',
      owner: 'Sarah Chen',
    })

    expect(incident.affectedServices).toEqual(['api-gateway', 'auth-service'])
    expect(incident.detectionSource).toBe('alert')
    expect(incident.owner).toBe('Sarah Chen')
  })

  it('retrieves incident by ID', () => {
    const created = incidentDatabase.create({
      title: 'Find Me',
      description: 'Test',
      severity: 'P2',
    })

    const found = incidentDatabase.getById(created.id)
    expect(found).toBeDefined()
    expect(found!.title).toBe('Find Me')
  })

  it('returns undefined for non-existent ID', () => {
    expect(incidentDatabase.getById('non-existent')).toBeUndefined()
  })

  it('returns all incidents', () => {
    const before = incidentDatabase.getAll().length
    incidentDatabase.create({ title: 'A', description: 'a', severity: 'P1' })
    incidentDatabase.create({ title: 'B', description: 'b', severity: 'P2' })
    expect(incidentDatabase.getAll().length).toBe(before + 2)
  })

  it('filters by status', () => {
    incidentDatabase.create({ title: 'Open One', description: 'test', severity: 'P1' })
    const openIncidents = incidentDatabase.getByStatus('Open')
    expect(openIncidents.length).toBeGreaterThan(0)
    expect(openIncidents.every(i => i.status === 'Open')).toBe(true)
  })

  it('returns active (non-resolved) incidents', () => {
    const active = incidentDatabase.getActive()
    expect(active.every(i => i.status !== 'Resolved')).toBe(true)
  })

  it('updates incident status', () => {
    const incident = incidentDatabase.create({
      title: 'Status Test',
      description: 'test',
      severity: 'P1',
    })

    const updated = incidentDatabase.updateStatus(incident.id, 'Investigating', 'Test User')
    expect(updated).toBeDefined()
    expect(updated!.status).toBe('Investigating')
    expect(updated!.timestamps.acknowledged).toBeTruthy()
    // Should have added a timeline event
    expect(updated!.timeline.length).toBeGreaterThan(1)
    expect(updated!.timeline.at(-1)!.description).toContain('Status changed from Open to Investigating')
  })

  it('sets resolved timestamp when resolving', () => {
    const incident = incidentDatabase.create({
      title: 'Resolve Test',
      description: 'test',
      severity: 'P2',
    })

    const resolved = incidentDatabase.updateStatus(incident.id, 'Resolved')
    expect(resolved!.timestamps.resolved).toBeTruthy()
  })

  it('returns null when updating non-existent incident', () => {
    expect(incidentDatabase.updateStatus('fake-id', 'Resolved')).toBeNull()
  })

  it('adds timeline event', () => {
    const incident = incidentDatabase.create({
      title: 'Timeline Test',
      description: 'test',
      severity: 'P1',
    })

    const updated = incidentDatabase.addTimelineEvent(incident.id, {
      type: 'comment',
      description: 'Test comment',
      author: 'Tester',
    })

    expect(updated).toBeDefined()
    const lastEvent = updated!.timeline.at(-1)!
    expect(lastEvent.type).toBe('comment')
    expect(lastEvent.description).toBe('Test comment')
    expect(lastEvent.author).toBe('Tester')
    expect(lastEvent.timestamp).toBeTruthy()
  })

  it('assigns owner', () => {
    const incident = incidentDatabase.create({
      title: 'Assign Test',
      description: 'test',
      severity: 'P2',
    })

    const updated = incidentDatabase.assignOwner(incident.id, 'Jane Doe', 'Admin')
    expect(updated!.owner).toBe('Jane Doe')
    expect(updated!.timeline.at(-1)!.type).toBe('assignment')
    expect(updated!.timeline.at(-1)!.description).toContain('Jane Doe')
  })

  it('updates incident fields', () => {
    const incident = incidentDatabase.create({
      title: 'Update Test',
      description: 'original',
      severity: 'P2',
    })

    const updated = incidentDatabase.update(incident.id, { description: 'updated' })
    expect(updated!.description).toBe('updated')
    expect(updated!.title).toBe('Update Test')
  })

  it('soft deletes by resolving', () => {
    const incident = incidentDatabase.create({
      title: 'Delete Test',
      description: 'test',
      severity: 'P3',
    })

    const result = incidentDatabase.delete(incident.id)
    expect(result).toBe(true)
    expect(incidentDatabase.getById(incident.id)!.status).toBe('Resolved')
  })

  it('hard deletes completely', () => {
    const incident = incidentDatabase.create({
      title: 'Hard Delete',
      description: 'test',
      severity: 'P3',
    })

    const result = incidentDatabase.delete(incident.id, true)
    expect(result).toBe(true)
    expect(incidentDatabase.getById(incident.id)).toBeUndefined()
  })

  it('returns stats', () => {
    const stats = incidentDatabase.getStats()
    expect(stats).toHaveProperty('total')
    expect(stats).toHaveProperty('active')
    expect(stats).toHaveProperty('byStatus')
    expect(stats).toHaveProperty('bySeverity')
    expect(stats.byStatus).toHaveProperty('Open')
    expect(stats.byStatus).toHaveProperty('Investigating')
    expect(stats.byStatus).toHaveProperty('Mitigated')
    expect(stats.byStatus).toHaveProperty('Resolved')
    expect(stats.bySeverity).toHaveProperty('P0')
    expect(stats.bySeverity).toHaveProperty('P4')
  })

  it('seeds incidents', () => {
    const before = incidentDatabase.getAll().length
    const seedData: Incident[] = [
      {
        id: 'SEED-1',
        title: 'Seeded',
        description: 'test',
        severity: 'P0',
        status: 'Open',
        affectedServices: [],
        detectionSource: 'manual',
        timestamps: { created: new Date().toISOString() },
        timeline: [],
      },
    ]
    incidentDatabase.seed(seedData)
    expect(incidentDatabase.getById('SEED-1')).toBeDefined()
    expect(incidentDatabase.getAll().length).toBe(before + 1)
  })
})
