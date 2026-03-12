import type { Incident } from '../types/incident'
import type {
  SecurityLog,
  AffectedAsset,
  RelatedIncident,
  RunbookEntry,
  AnalysisResult,
} from '../types/analysis'

// --- Seed pools ---

const logTemplates: { source: string; severity: SecurityLog['severity']; message: string }[] = [
  { source: 'WAF', severity: 'critical', message: 'Anomalous spike in blocked requests from IP range {ip}' },
  { source: 'IDS', severity: 'error', message: 'Signature match: potential SQL injection on endpoint /api/{service}' },
  { source: 'Auth Service', severity: 'warning', message: 'Failed login attempts exceeded threshold for user pool' },
  { source: 'CloudTrail', severity: 'info', message: 'IAM role assumption detected from unfamiliar region' },
  { source: 'Load Balancer', severity: 'error', message: 'Health check failures on {service} backend pool' },
  { source: 'DNS Monitor', severity: 'warning', message: 'Unusual DNS query volume targeting internal zones' },
  { source: 'Certificate Manager', severity: 'warning', message: 'TLS certificate expiring in 48h for {service}.prod' },
  { source: 'SIEM', severity: 'critical', message: 'Correlated alert: lateral movement pattern detected across 3 hosts' },
  { source: 'Container Runtime', severity: 'error', message: 'Pod crash loop detected in {service} deployment' },
  { source: 'APM', severity: 'warning', message: 'P99 latency exceeded SLA threshold on {service}' },
  { source: 'Firewall', severity: 'info', message: 'New outbound connection to previously unseen destination' },
  { source: 'Secrets Manager', severity: 'critical', message: 'Secret rotation failure for {service} database credentials' },
  { source: 'Kubernetes', severity: 'error', message: 'Node NotReady condition detected in production cluster' },
  { source: 'Rate Limiter', severity: 'warning', message: 'Rate limit triggered: 10k requests/min from single client' },
  { source: 'Audit Log', severity: 'info', message: 'Privileged operation performed: security group rule modified' },
]

const assetPool: { name: string; type: AffectedAsset['type'] }[] = [
  { name: 'web-prod-01', type: 'server' },
  { name: 'api-gateway', type: 'service' },
  { name: 'postgres-primary', type: 'database' },
  { name: 'redis-cache', type: 'database' },
  { name: 'cdn-edge', type: 'cdn' },
  { name: 'vpc-internal', type: 'network' },
  { name: 'auth-service', type: 'service' },
  { name: 's3-data-lake', type: 'storage' },
  { name: 'kafka-broker', type: 'service' },
  { name: 'mongo-analytics', type: 'database' },
]

export const runbookPool: RunbookEntry[] = [
  {
    id: 'rb-1', title: 'Database Failover Procedure', estimatedMinutes: 15,
    matchedServices: ['postgres', 'database', 'db', 'mongo', 'redis'],
    steps: ['Verify replica health', 'Promote standby to primary', 'Update connection strings', 'Validate application connectivity', 'Monitor for replication lag'],
  },
  {
    id: 'rb-2', title: 'Service Restart & Health Check', estimatedMinutes: 10,
    matchedServices: ['api', 'service', 'gateway', 'auth'],
    steps: ['Drain active connections', 'Restart service pods', 'Run health check suite', 'Verify downstream dependencies', 'Re-enable traffic routing'],
  },
  {
    id: 'rb-3', title: 'DDoS Mitigation Playbook', estimatedMinutes: 20,
    matchedServices: ['cdn', 'waf', 'network', 'load balancer', 'firewall'],
    steps: ['Enable rate limiting at edge', 'Activate GeoIP blocking for suspect regions', 'Scale WAF rules', 'Coordinate with upstream provider', 'Monitor traffic normalization'],
  },
  {
    id: 'rb-4', title: 'Credential Rotation Emergency', estimatedMinutes: 25,
    matchedServices: ['auth', 'secrets', 'iam', 'credentials'],
    steps: ['Identify compromised credentials', 'Revoke active sessions', 'Rotate affected secrets', 'Update dependent services', 'Audit access logs for unauthorized use', 'Notify security team'],
  },
  {
    id: 'rb-5', title: 'Network Partition Recovery', estimatedMinutes: 30,
    matchedServices: ['network', 'vpc', 'dns', 'firewall'],
    steps: ['Identify affected network segments', 'Check routing tables and security groups', 'Verify DNS resolution', 'Restore connectivity', 'Run end-to-end connectivity tests'],
  },
  {
    id: 'rb-6', title: 'Container Crash Loop Resolution', estimatedMinutes: 12,
    matchedServices: ['kubernetes', 'container', 'pod', 'deployment', 'k8s'],
    steps: ['Check pod logs for error details', 'Review recent deployment changes', 'Rollback to last known good image', 'Verify resource limits', 'Confirm pods healthy'],
  },
  {
    id: 'rb-7', title: 'Cache Layer Recovery', estimatedMinutes: 8,
    matchedServices: ['redis', 'cache', 'memcached'],
    steps: ['Check cache node health', 'Flush corrupted keys if needed', 'Warm cache from source', 'Validate hit rates returning to normal'],
  },
  {
    id: 'rb-8', title: 'SSL/TLS Certificate Renewal', estimatedMinutes: 15,
    matchedServices: ['certificate', 'tls', 'ssl', 'cdn', 'web'],
    steps: ['Verify certificate expiration status', 'Request new certificate from CA', 'Deploy to edge nodes', 'Test HTTPS connectivity', 'Update monitoring alerts'],
  },
]

const historicalIncidents: Omit<RelatedIncident, 'id'>[] = [
  { title: 'API gateway timeout during traffic spike', severity: 'P1', similarityPct: 0, rootCause: 'Insufficient auto-scaling configuration' },
  { title: 'Database connection pool exhaustion', severity: 'P0', similarityPct: 0, rootCause: 'Connection leak in ORM layer' },
  { title: 'Authentication service degradation', severity: 'P2', similarityPct: 0, rootCause: 'Token validation cache invalidation bug' },
  { title: 'CDN cache poisoning attempt', severity: 'P1', similarityPct: 0, rootCause: 'Missing cache key normalization' },
  { title: 'Network partition in us-east-1', severity: 'P0', similarityPct: 0, rootCause: 'BGP route leak from upstream provider' },
  { title: 'Kubernetes node pressure evictions', severity: 'P2', similarityPct: 0, rootCause: 'Memory limits not set on new deployment' },
]

// --- Helpers ---

function pick<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(n, arr.length))
}

function randBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

const ipPool = ['10.0.3.42', '192.168.1.105', '172.16.0.88', '10.255.0.12', '203.0.113.7']

function interpolate(msg: string, service: string): string {
  return msg
    .replace(/\{service\}/g, service || 'app')
    .replace(/\{ip\}/g, ipPool[randBetween(0, ipPool.length - 1)])
}

const severityRiskMap: Record<string, number> = { P0: 95, P1: 78, P2: 55, P3: 32, P4: 15 }

// --- Generator ---

export function generateAnalysis(incident: Incident, allIncidents: Incident[]): AnalysisResult {
  const primaryService = incident.affectedServices[0] || 'app'
  const createdMs = new Date(incident.timestamps.created).getTime()

  // Security logs: 5-15, timestamps spread before incident creation
  const logCount = randBetween(5, 15)
  const selectedLogs = pick(logTemplates, logCount)
  const securityLogs: SecurityLog[] = selectedLogs.map((tpl, i) => {
    const offsetMs = randBetween(5 * 60_000, 120 * 60_000) // 5min to 2h before
    return {
      id: crypto.randomUUID(),
      timestamp: new Date(createdMs - offsetMs + i * 1000).toISOString(),
      source: tpl.source,
      severity: tpl.severity,
      message: interpolate(tpl.message, primaryService),
      rawData: JSON.stringify({ event_id: crypto.randomUUID().slice(0, 8), source: tpl.source, level: tpl.severity }),
    }
  }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  // Affected assets: map from affected services + some extras
  const serviceAssets: AffectedAsset[] = incident.affectedServices.map(svc => {
    const match = assetPool.find(a => a.name.includes(svc.toLowerCase())) || assetPool[randBetween(0, assetPool.length - 1)]
    const status: AffectedAsset['status'] =
      incident.severity === 'P0' ? 'down' :
      incident.severity === 'P1' ? 'degraded' :
      Math.random() > 0.5 ? 'degraded' : 'healthy'
    return {
      id: crypto.randomUUID(),
      name: svc,
      type: match.type,
      status,
      riskScore: randBetween(
        status === 'down' ? 80 : status === 'degraded' ? 40 : 10,
        status === 'down' ? 100 : status === 'degraded' ? 79 : 39,
      ),
    }
  })
  const extraAssets = pick(assetPool, randBetween(1, 3))
    .filter(a => !serviceAssets.some(sa => sa.name === a.name))
    .map(a => ({
      id: crypto.randomUUID(),
      name: a.name,
      type: a.type,
      status: 'healthy' as const,
      riskScore: randBetween(5, 25),
    }))
  const affectedAssets = [...serviceAssets, ...extraAssets]

  // Related incidents: keyword/service overlap from real + historical
  const keywords = [
    ...incident.title.toLowerCase().split(/\s+/),
    ...incident.affectedServices.map(s => s.toLowerCase()),
  ]
  const realRelated: RelatedIncident[] = allIncidents
    .filter(i => i.id !== incident.id)
    .map(i => {
      const titleWords = i.title.toLowerCase().split(/\s+/)
      const overlap = keywords.filter(k => titleWords.includes(k) || i.affectedServices.some(s => s.toLowerCase().includes(k)))
      const similarity = Math.min(95, Math.round((overlap.length / Math.max(keywords.length, 1)) * 100) + randBetween(5, 20))
      return {
        id: i.id,
        title: i.title,
        severity: i.severity,
        similarityPct: similarity,
        rootCause: i.status === 'Resolved' ? 'Resolved - see incident timeline' : 'Under investigation',
      }
    })
    .filter(r => r.similarityPct > 15)
    .slice(0, 3)

  const seedRelated: RelatedIncident[] = pick(historicalIncidents, randBetween(2, 4)).map(h => ({
    ...h,
    id: crypto.randomUUID(),
    similarityPct: randBetween(25, 75),
  }))

  const relatedIncidents = [...realRelated, ...seedRelated]
    .sort((a, b) => b.similarityPct - a.similarityPct)
    .slice(0, 5)

  // Runbooks: match by service/keyword
  const allTerms = [...incident.affectedServices.map(s => s.toLowerCase()), incident.severity.toLowerCase()]
  const runbooks = runbookPool
    .filter(rb => rb.matchedServices.some(ms => allTerms.some(t => t.includes(ms) || ms.includes(t))))
    .slice(0, 4)
  if (runbooks.length === 0) {
    runbooks.push(runbookPool[1]) // fallback: generic service restart
  }

  // Risk score
  const baseRisk = severityRiskMap[incident.severity] ?? 50
  const riskScore = Math.min(100, baseRisk + randBetween(-5, 10))

  // Summary
  const summary = `Analysis of "${incident.title}" identified ${securityLogs.length} security events, ` +
    `${affectedAssets.filter(a => a.status !== 'healthy').length} impacted assets, and ` +
    `${relatedIncidents.length} related historical incidents. ` +
    `Risk score: ${riskScore}/100 (${riskScore >= 80 ? 'Critical' : riskScore >= 60 ? 'High' : riskScore >= 40 ? 'Medium' : 'Low'}). ` +
    `${runbooks.length} runbook${runbooks.length !== 1 ? 's' : ''} recommended for remediation.`

  return {
    riskScore,
    summary,
    analyzedAt: new Date().toISOString(),
    securityLogs,
    affectedAssets,
    relatedIncidents,
    runbooks,
  }
}
