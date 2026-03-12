import type { Incident, IncidentStatus, CreateIncidentInput } from '../types/incident'
import type { AnalysisResult, SecurityLog, RunbookEntry } from '../types/analysis'
import { incidentDatabase } from './incidentDatabase'
import { generateAnalysis, runbookPool } from '../data/mockAnalysisData'
import { getSeedIncidents } from '../data/seedIncidents'

function delay(ms?: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms ?? (100 + Math.random() * 200)))
}

export async function fetchAllIncidents(): Promise<Incident[]> {
  await delay()
  if (incidentDatabase.getAll().length === 0) {
    incidentDatabase.seed(getSeedIncidents())
  }
  return incidentDatabase.getAll()
}

export async function fetchIncidentById(id: string): Promise<Incident | null> {
  await delay()
  return incidentDatabase.getById(id) ?? null
}

export async function createIncident(input: CreateIncidentInput): Promise<Incident> {
  await delay()
  return incidentDatabase.create(input)
}

export async function updateIncidentStatus(
  id: string,
  status: IncidentStatus,
  author?: string,
): Promise<Incident | null> {
  await delay()
  return incidentDatabase.updateStatus(id, status, author)
}

export async function fetchAnalysis(
  incident: Incident,
  allIncidents: Incident[],
): Promise<AnalysisResult> {
  await delay(200 + Math.random() * 100)
  return generateAnalysis(incident, allIncidents)
}

export async function searchLogs(
  incident: Incident,
  allIncidents: Incident[],
  query: string,
): Promise<SecurityLog[]> {
  await delay()
  const analysis = generateAnalysis(incident, allIncidents)
  const q = query.toLowerCase()
  return analysis.securityLogs.filter(
    log => log.message.toLowerCase().includes(q) || log.source.toLowerCase().includes(q),
  )
}

export async function fetchRunbooks(
  incident: Incident,
  allIncidents: Incident[],
): Promise<RunbookEntry[]> {
  await delay()
  const analysis = generateAnalysis(incident, allIncidents)
  return analysis.runbooks
}

export async function fetchRunbookById(id: string): Promise<RunbookEntry | null> {
  await delay()
  return runbookPool.find(rb => rb.id === id) ?? null
}
