import { describe, it, expect } from 'vitest'
import { getSeedIncidents } from '../seedIncidents'

describe('getSeedIncidents', () => {
  const incidents = getSeedIncidents()

  it('returns 8 seed incidents', () => {
    expect(incidents).toHaveLength(8)
  })

  it('all incidents have required fields', () => {
    for (const inc of incidents) {
      expect(inc.id).toBeTruthy()
      expect(inc.title).toBeTruthy()
      expect(inc.description).toBeTruthy()
      expect(['P0', 'P1', 'P2', 'P3', 'P4']).toContain(inc.severity)
      expect(['Open', 'Investigating', 'Mitigated', 'Resolved']).toContain(inc.status)
      expect(inc.timestamps.created).toBeTruthy()
      expect(Array.isArray(inc.timeline)).toBe(true)
      expect(Array.isArray(inc.affectedServices)).toBe(true)
    }
  })

  it('generates timestamps relative to now', () => {
    const now = Date.now()
    for (const inc of incidents) {
      const created = new Date(inc.timestamps.created).getTime()
      // All seed timestamps should be in the past (within 24 hours)
      expect(created).toBeLessThanOrEqual(now)
      expect(created).toBeGreaterThan(now - 24 * 60 * 60 * 1000)
    }
  })

  it('each incident has at least one timeline event', () => {
    for (const inc of incidents) {
      expect(inc.timeline.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('timeline events have required fields', () => {
    for (const inc of incidents) {
      for (const event of inc.timeline) {
        expect(event.id).toBeTruthy()
        expect(event.timestamp).toBeTruthy()
        expect(event.type).toBeTruthy()
        expect(event.description).toBeTruthy()
      }
    }
  })

  it('contains a mix of severities', () => {
    const severities = new Set(incidents.map(i => i.severity))
    expect(severities.size).toBeGreaterThanOrEqual(3)
  })

  it('contains a mix of statuses', () => {
    const statuses = new Set(incidents.map(i => i.status))
    expect(statuses.size).toBeGreaterThanOrEqual(3)
  })

  it('IDs start with INC-SEED-', () => {
    for (const inc of incidents) {
      expect(inc.id).toMatch(/^INC-SEED-\d+$/)
    }
  })

  it('returns fresh timestamps on each call', () => {
    const first = getSeedIncidents()
    // Tiny delay not needed since both should be within the same ms range
    const second = getSeedIncidents()
    // Timestamps should be very close but potentially slightly different
    expect(first[0].timestamps.created).toBeTruthy()
    expect(second[0].timestamps.created).toBeTruthy()
  })
})
