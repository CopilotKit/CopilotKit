import { describe, it, expect } from 'vitest'
import { generateAnalysis } from '../mockAnalysisData'
import type { Incident } from '../../types/incident'

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'INC-1',
    title: 'API Gateway Down',
    description: 'Gateway returning 502 errors',
    severity: 'P0',
    status: 'Open',
    affectedServices: ['api-gateway', 'auth-service'],
    detectionSource: 'alert',
    timestamps: { created: '2024-06-15T10:00:00Z' },
    timeline: [],
    ...overrides,
  }
}

describe('generateAnalysis', () => {
  it('returns a valid analysis result', () => {
    const incident = makeIncident()
    const analysis = generateAnalysis(incident, [incident])

    expect(analysis).toHaveProperty('riskScore')
    expect(analysis).toHaveProperty('summary')
    expect(analysis).toHaveProperty('analyzedAt')
    expect(analysis).toHaveProperty('securityLogs')
    expect(analysis).toHaveProperty('affectedAssets')
    expect(analysis).toHaveProperty('relatedIncidents')
    expect(analysis).toHaveProperty('runbooks')
  })

  it('risk score is between 0 and 100', () => {
    const analysis = generateAnalysis(makeIncident(), [])
    expect(analysis.riskScore).toBeGreaterThanOrEqual(0)
    expect(analysis.riskScore).toBeLessThanOrEqual(100)
  })

  it('P0 incidents have higher risk scores than P4', () => {
    const p0Analysis = generateAnalysis(makeIncident({ severity: 'P0' }), [])
    const p4Analysis = generateAnalysis(makeIncident({ severity: 'P4' }), [])
    expect(p0Analysis.riskScore).toBeGreaterThan(p4Analysis.riskScore)
  })

  it('generates security logs', () => {
    const analysis = generateAnalysis(makeIncident(), [])
    expect(analysis.securityLogs.length).toBeGreaterThan(0)

    for (const log of analysis.securityLogs) {
      expect(log.id).toBeTruthy()
      expect(log.timestamp).toBeTruthy()
      expect(log.source).toBeTruthy()
      expect(log.severity).toBeTruthy()
      expect(log.message).toBeTruthy()
    }
  })

  it('generates affected assets from services', () => {
    const incident = makeIncident({ affectedServices: ['api-gateway', 'database'] })
    const analysis = generateAnalysis(incident, [])

    expect(analysis.affectedAssets.length).toBeGreaterThan(0)
    for (const asset of analysis.affectedAssets) {
      expect(asset.id).toBeTruthy()
      expect(asset.name).toBeTruthy()
      expect(asset.type).toBeTruthy()
      expect(asset.status).toBeTruthy()
      expect(asset.riskScore).toBeGreaterThanOrEqual(0)
    }
  })

  it('generates runbooks', () => {
    const analysis = generateAnalysis(makeIncident(), [])
    expect(analysis.runbooks.length).toBeGreaterThan(0)

    for (const rb of analysis.runbooks) {
      expect(rb.id).toBeTruthy()
      expect(rb.title).toBeTruthy()
      expect(rb.estimatedMinutes).toBeGreaterThan(0)
      expect(rb.steps.length).toBeGreaterThan(0)
    }
  })

  it('finds related incidents based on shared services', () => {
    const target = makeIncident({
      id: 'TARGET',
      affectedServices: ['api-gateway'],
    })
    const related = makeIncident({
      id: 'RELATED',
      title: 'Another API issue',
      affectedServices: ['api-gateway'],
    })
    const unrelated = makeIncident({
      id: 'UNRELATED',
      title: 'DB issue',
      affectedServices: ['database'],
    })

    const analysis = generateAnalysis(target, [target, related, unrelated])
    // Related incidents should not include the target itself
    expect(analysis.relatedIncidents.every(ri => ri.id !== 'TARGET')).toBe(true)
  })

  it('summary is a non-empty string', () => {
    const analysis = generateAnalysis(makeIncident(), [])
    expect(analysis.summary).toBeTruthy()
    expect(typeof analysis.summary).toBe('string')
  })

  it('analyzedAt is a valid ISO date', () => {
    const analysis = generateAnalysis(makeIncident(), [])
    expect(new Date(analysis.analyzedAt).toISOString()).toBe(analysis.analyzedAt)
  })
})
