import type { IncidentSeverity } from './incident'

export interface SecurityLog {
  id: string
  timestamp: string
  source: string
  severity: 'info' | 'warning' | 'error' | 'critical'
  message: string
  rawData?: string
}

export interface AffectedAsset {
  id: string
  name: string
  type: 'server' | 'database' | 'service' | 'network' | 'storage' | 'cdn'
  status: 'healthy' | 'degraded' | 'down'
  riskScore: number
}

export interface RelatedIncident {
  id: string
  title: string
  severity: IncidentSeverity
  similarityPct: number
  rootCause: string
}

export interface RunbookEntry {
  id: string
  title: string
  estimatedMinutes: number
  matchedServices: string[]
  steps: string[]
}

export interface AnalysisResult {
  riskScore: number
  summary: string
  analyzedAt: string
  securityLogs: SecurityLog[]
  affectedAssets: AffectedAsset[]
  relatedIncidents: RelatedIncident[]
  runbooks: RunbookEntry[]
}
