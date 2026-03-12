import { useFrontendTool, useRenderToolCall } from '@copilotkit/react-core'
import type { Incident } from '../types/incident'
import { generateAnalysis } from '../data/mockAnalysisData'
import {
  SeverityDistributionChart,
  StatusBreakdownChart,
  IncidentTimelineChart,
  ServiceImpactChart,
} from './charts/IncidentCharts'
import type { IncidentFormData } from './ChatIncidentForm'

interface CounterControllerProps {
  incidents: Incident[]
  setIncidents: React.Dispatch<React.SetStateAction<Incident[]>>
  onAiFillForm: (data: Partial<IncidentFormData>) => void
}

export function CounterController({ incidents, setIncidents, onAiFillForm }: CounterControllerProps) {
  // Tool: Resolve an incident by ID (or the most recent one)
  useFrontendTool({
    name: 'resolveIncident',
    description: 'Resolve an incident. If no incidentId is provided, resolves the most recent open incident.',
    parameters: [
      {
        name: 'incidentId',
        type: 'string',
        description: 'The ID of the incident to resolve. If omitted, the most recent open incident is resolved.',
        required: false,
      },
    ],
    handler: async ({ incidentId }: { incidentId?: string }) => {
      const target = incidentId
        ? incidents.find(i => i.id === incidentId)
        : incidents.find(i => i.status !== 'Resolved')

      if (!target) return 'No open incidents to resolve.'

      setIncidents(prev =>
        prev.map(i =>
          i.id === target.id
            ? { ...i, status: 'Resolved' as const, timestamps: { ...i.timestamps, resolved: new Date().toISOString() } }
            : i
        )
      )
      return `Resolved incident "${target.title}" (${target.id}).`
    },
  }, [incidents])

  // Tool: Clear all incidents (resolve all)
  useFrontendTool({
    name: 'clearAllIncidents',
    description: 'Resolve all active incidents at once.',
    parameters: [],
    handler: async () => {
      const now = new Date().toISOString()
      setIncidents(prev =>
        prev.map(i =>
          i.status !== 'Resolved'
            ? { ...i, status: 'Resolved' as const, timestamps: { ...i.timestamps, resolved: now } }
            : i
        )
      )
      return 'All incidents resolved.'
    },
  }, [incidents])

  // Tool: Update incident status
  useFrontendTool({
    name: 'updateIncidentStatus',
    description: 'Change the status of an incident. Valid statuses: Open, Investigating, Mitigated, Resolved. A timeline event is automatically created.',
    parameters: [
      { name: 'incidentId', type: 'string', description: 'The ID of the incident to update', required: true },
      { name: 'status', type: 'string', description: 'New status: Open, Investigating, Mitigated, or Resolved', required: true },
    ],
    handler: async ({ incidentId, status }: { incidentId: string; status: string }) => {
      const validStatuses = ['Open', 'Investigating', 'Mitigated', 'Resolved'] as const
      if (!validStatuses.includes(status as any)) {
        return `Invalid status "${status}". Must be one of: ${validStatuses.join(', ')}`
      }
      const target = incidents.find(i => i.id === incidentId)
      if (!target) return `Incident ${incidentId} not found.`

      const now = new Date().toISOString()
      const newStatus = status as typeof validStatuses[number]
      setIncidents(prev =>
        prev.map(i => {
          if (i.id !== incidentId) return i
          return {
            ...i,
            status: newStatus,
            timestamps: {
              ...i.timestamps,
              ...(newStatus === 'Resolved' ? { resolved: now } : {}),
              ...(newStatus === 'Investigating' && !i.timestamps.acknowledged ? { acknowledged: now } : {}),
            },
            timeline: [
              ...i.timeline,
              {
                id: crypto.randomUUID(),
                timestamp: now,
                type: 'status_change' as const,
                description: `Status changed from ${i.status} to ${newStatus}`,
                author: 'AI Assistant',
              },
            ],
          }
        })
      )
      return `Updated incident "${target.title}" status to ${newStatus}.`
    },
  }, [incidents])

  // Tool: Add a comment to an incident's timeline
  useFrontendTool({
    name: 'addIncidentComment',
    description: 'Add a comment to an incident timeline. Use this to log observations, updates, or notes on an incident.',
    parameters: [
      { name: 'incidentId', type: 'string', description: 'The ID of the incident', required: true },
      { name: 'comment', type: 'string', description: 'The comment text to add', required: true },
    ],
    handler: async ({ incidentId, comment }: { incidentId: string; comment: string }) => {
      const target = incidents.find(i => i.id === incidentId)
      if (!target) return `Incident ${incidentId} not found.`

      setIncidents(prev =>
        prev.map(i => {
          if (i.id !== incidentId) return i
          return {
            ...i,
            timeline: [
              ...i.timeline,
              {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                type: 'comment' as const,
                description: comment,
                author: 'AI Assistant',
              },
            ],
          }
        })
      )
      return `Added comment to incident "${target.title}".`
    },
  }, [incidents])

  // Tool: Report/fill a new incident — updates the shared form in the sidebar
  useFrontendTool({
    name: 'reportIncident',
    description:
      'Fill out the incident report form with details extracted from the conversation. ' +
      'You MUST fill ALL 6 fields: title, description, severity, type, affectedSystems, assignee. ' +
      'Use your best judgment to infer values for fields the user didn\'t mention. ' +
      'The form will switch to review mode so the user can confirm before submitting.',
    parameters: [
      { name: 'title', type: 'string', description: 'Short title of the incident', required: true },
      { name: 'description', type: 'string', description: 'Detailed description of the incident', required: true },
      { name: 'severity', type: 'string', description: 'Severity: P0 (critical), P1 (high), P2 (medium), P3 (low), P4 (info)', required: true },
      { name: 'type', type: 'string', description: 'Incident type: security, performance, availability, data, or other', required: true },
      { name: 'affectedSystems', type: 'string', description: 'Comma-separated list of affected systems/services', required: true },
      { name: 'assignee', type: 'string', description: 'Person or team to assign the incident to', required: true },
    ],
    handler: async (args: {
      title: string
      description: string
      severity: string
      type: string
      affectedSystems: string
      assignee: string
    }) => {
      // Update the shared form state — the portal form will reactively show the filled data
      onAiFillForm({
        title: args.title,
        description: args.description,
        severity: args.severity,
        type: args.type,
        affectedSystems: args.affectedSystems,
        assignee: args.assignee,
      })
      return `Incident form has been filled with all details. The user can now review and confirm.`
    },
  }, [incidents])

  // Tool: Analyze an incident — generates security intelligence
  useFrontendTool({
    name: 'analyzeIncident',
    description: 'Run a security analysis on an incident. Returns risk score, security logs, affected assets, related incidents, and recommended runbooks.',
    parameters: [
      { name: 'incidentId', type: 'string', description: 'The ID of the incident to analyze', required: true },
    ],
    handler: async ({ incidentId }: { incidentId: string }) => {
      const target = incidents.find(i => i.id === incidentId)
      if (!target) return `Incident ${incidentId} not found.`

      const analysis = generateAnalysis(target, incidents)
      return [
        `**Analysis for "${target.title}"**`,
        `Risk Score: ${analysis.riskScore}/100`,
        `Summary: ${analysis.summary}`,
        '',
        `**Security Logs** (${analysis.securityLogs.length}):`,
        ...analysis.securityLogs.slice(0, 5).map(l => `- [${l.severity.toUpperCase()}] ${l.source}: ${l.message}`),
        analysis.securityLogs.length > 5 ? `  ...and ${analysis.securityLogs.length - 5} more` : '',
        '',
        `**Affected Assets** (${analysis.affectedAssets.length}):`,
        ...analysis.affectedAssets.map(a => `- ${a.name} (${a.type}) — ${a.status}, risk: ${a.riskScore}`),
        '',
        `**Related Incidents** (${analysis.relatedIncidents.length}):`,
        ...analysis.relatedIncidents.map(r => `- ${r.title} [${r.severity}] — ${r.similarityPct}% similar — ${r.rootCause}`),
        '',
        `**Recommended Runbooks** (${analysis.runbooks.length}):`,
        ...analysis.runbooks.map(r => `- ${r.title} (~${r.estimatedMinutes} min)`),
      ].filter(Boolean).join('\n')
    },
  }, [incidents])

  // Tool: Generate a chart — handler only, rendering is separate below
  useFrontendTool({
    name: 'generateChart',
    description:
      'Render an interactive chart in the chat based on incident data. The chart is rendered visually by the UI automatically — do NOT include any markdown images or image syntax in your text response. ' +
      'Chart types: "severity" (pie chart of P0-P4 distribution), ' +
      '"status" (bar chart of Open/Investigating/Mitigated/Resolved), ' +
      '"timeline" (area chart of incidents over time), ' +
      '"services" (horizontal bar chart of most-affected services).',
    parameters: [
      {
        name: 'chartType',
        type: 'string',
        description: 'The type of chart to render: severity, status, timeline, or services',
        required: true,
      },
    ],
    handler: async ({ chartType }: { chartType: string }) => {
      const validTypes = ['severity', 'status', 'timeline', 'services'] as const
      if (!validTypes.includes(chartType as any)) {
        return `Invalid chart type "${chartType}". Must be one of: ${validTypes.join(', ')}`
      }

      const total = incidents.length
      const summaries: Record<string, string> = {
        severity: `Severity distribution across ${total} incidents: ${['P0','P1','P2','P3','P4'].map(s => `${s}: ${incidents.filter(i => i.severity === s).length}`).join(', ')}`,
        status: `Status breakdown across ${total} incidents: ${['Open','Investigating','Mitigated','Resolved'].map(s => `${s}: ${incidents.filter(i => i.status === s).length}`).join(', ')}`,
        timeline: `Timeline of ${total} incidents from ${incidents.length ? new Date(Math.min(...incidents.map(i => new Date(i.timestamps.created).getTime()))).toLocaleDateString() : 'N/A'} to ${incidents.length ? new Date(Math.max(...incidents.map(i => new Date(i.timestamps.created).getTime()))).toLocaleDateString() : 'N/A'}`,
        services: `Top affected services across ${total} incidents`,
      }

      return summaries[chartType] || `Chart rendered for ${total} incidents.`
    },
  }, [incidents])

  // Render: generateChart tool calls get rendered as chart components in the chat
  useRenderToolCall({
    name: 'generateChart',
    description: 'Renders a chart in the chat',
    parameters: [
      {
        name: 'chartType',
        type: 'string',
        description: 'The type of chart to render',
        required: true,
      },
    ],
    render: (props) => {
      if (props.status === 'executing' || props.status === 'inProgress') {
        return (
          <div className="chart-loading">
            <div className="chart-loading-spinner" />
            Generating chart...
          </div>
        )
      }

      const chartType = props.args?.chartType

      const chartMap: Record<string, React.ReactElement> = {
        severity: <SeverityDistributionChart incidents={incidents} />,
        status: <StatusBreakdownChart incidents={incidents} />,
        timeline: <IncidentTimelineChart incidents={incidents} />,
        services: <ServiceImpactChart incidents={incidents} />,
      }

      return chartMap[chartType] || <SeverityDistributionChart incidents={incidents} />
    },
  }, [incidents])

  return null
}
