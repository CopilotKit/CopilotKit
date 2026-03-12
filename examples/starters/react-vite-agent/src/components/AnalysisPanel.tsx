import { useState } from 'react'
import type { Incident } from '../types/incident'
import type { AnalysisResult } from '../types/analysis'
import { generateAnalysis } from '../data/mockAnalysisData'
import './AnalysisPanel.css'

const severityColors: Record<string, string> = {
  P0: '#ef4444',
  P1: '#f97316',
  P2: '#eab308',
  P3: '#3b82f6',
  P4: '#6b7280',
}

function formatLogTime(ts: string) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function riskLevel(score: number): string {
  if (score >= 80) return 'critical'
  if (score >= 60) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

interface AnalysisPanelProps {
  incident: Incident
  allIncidents: Incident[]
}

export function AnalysisPanel({ incident, allIncidents }: AnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set())
  const [expandedRunbooks, setExpandedRunbooks] = useState<Set<string>>(new Set())

  const handleRunAnalysis = () => {
    setLoading(true)
    setTimeout(() => {
      const result = generateAnalysis(incident, allIncidents)
      setAnalysis(result)
      setLoading(false)
    }, 400)
  }

  const toggleLog = (id: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleRunbook = (id: string) => {
    setExpandedRunbooks(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (loading) {
    return (
      <div className="analysis-loading">
        <div className="analysis-spinner" />
        Analyzing incident...
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="analysis-trigger">
        <p>Run a security analysis to generate logs, affected assets, related incidents, and recommended runbooks.</p>
        <button className="btn-run-analysis" onClick={handleRunAnalysis}>
          Run Analysis
        </button>
      </div>
    )
  }

  return (
    <div className="analysis-panel">
      {/* Risk Summary */}
      <div className="risk-summary">
        <div className="risk-summary-header">
          <div>
            <div className="risk-label">Risk Score</div>
            <div className={`risk-badge ${riskLevel(analysis.riskScore)}`}>
              {analysis.riskScore}
            </div>
          </div>
          <div className="risk-timestamp">
            Analyzed {new Date(analysis.analyzedAt).toLocaleString()}
          </div>
        </div>
        <p>{analysis.summary}</p>
      </div>

      {/* Security Logs */}
      <div>
        <h4 className="analysis-section-title">
          Security Logs
          <span className="analysis-section-count">{analysis.securityLogs.length}</span>
        </h4>
        <div style={{ overflowX: 'auto' }}>
          <table className="logs-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>Severity</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {analysis.securityLogs.map(log => (
                <tr key={log.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLogTime(log.timestamp)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{log.source}</td>
                  <td>
                    <span className={`log-severity ${log.severity}`}>{log.severity}</span>
                  </td>
                  <td>
                    {log.message}
                    {log.rawData && (
                      <>
                        {' '}
                        <button className="log-raw-toggle" onClick={() => toggleLog(log.id)}>
                          {expandedLogs.has(log.id) ? 'hide raw' : 'raw'}
                        </button>
                        {expandedLogs.has(log.id) && (
                          <div className="log-raw-data">{log.rawData}</div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Affected Assets */}
      <div>
        <h4 className="analysis-section-title">
          Affected Assets
          <span className="analysis-section-count">{analysis.affectedAssets.length}</span>
        </h4>
        <div className="assets-grid">
          {analysis.affectedAssets.map(asset => (
            <div key={asset.id} className="asset-card">
              <div className="asset-card-header">
                <span className="asset-name">{asset.name}</span>
                <span className={`asset-status-dot ${asset.status}`} title={asset.status} />
              </div>
              <div className="asset-meta">
                <span>{asset.type}</span>
                <span>Risk: {asset.riskScore}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Related Incidents */}
      <div>
        <h4 className="analysis-section-title">
          Related Incidents
          <span className="analysis-section-count">{analysis.relatedIncidents.length}</span>
        </h4>
        <div className="related-list">
          {analysis.relatedIncidents.map(ri => (
            <div key={ri.id} className="related-card">
              <div className="related-card-header">
                <span className="related-title">{ri.title}</span>
                <span
                  className="related-severity"
                  style={{ backgroundColor: severityColors[ri.severity] }}
                >
                  {ri.severity}
                </span>
                <span className="related-similarity">{ri.similarityPct}%</span>
              </div>
              <p className="related-root-cause">{ri.rootCause}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recommended Runbooks */}
      <div>
        <h4 className="analysis-section-title">
          Recommended Runbooks
          <span className="analysis-section-count">{analysis.runbooks.length}</span>
        </h4>
        <div className="runbook-list">
          {analysis.runbooks.map(rb => (
            <div key={rb.id} className="runbook-item">
              <button className="runbook-header" onClick={() => toggleRunbook(rb.id)}>
                <div className="runbook-title-row">
                  <span className={`runbook-chevron ${expandedRunbooks.has(rb.id) ? 'open' : ''}`}>
                    &#9654;
                  </span>
                  <span className="runbook-title">{rb.title}</span>
                </div>
                <span className="runbook-time">~{rb.estimatedMinutes} min</span>
              </button>
              {expandedRunbooks.has(rb.id) && (
                <div className="runbook-steps">
                  <ol>
                    {rb.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
