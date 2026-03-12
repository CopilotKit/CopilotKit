import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { CounterController } from './CounterController'
import type { Incident } from '../types/incident'

// Capture every hook registration
const registeredTools: Array<{ name: string; deps: unknown[]; tool: Record<string, unknown> }> = []
const registeredRenderers: Array<{ name: string; deps: unknown[]; tool: Record<string, unknown> }> = []

vi.mock('@copilotkit/react-core', () => ({
  useFrontendTool: (tool: Record<string, unknown>, deps: unknown[]) => {
    registeredTools.push({ name: tool.name as string, deps, tool })
  },
  useRenderToolCall: (tool: Record<string, unknown>, deps: unknown[]) => {
    registeredRenderers.push({ name: tool.name as string, deps, tool })
  },
}))

const mockIncidents: Incident[] = [
  {
    id: 'INC-001',
    title: 'API outage',
    description: 'Gateway down',
    severity: 'P0',
    status: 'Open',
    affectedServices: ['api-gateway', 'auth-service'],
    detectionSource: 'alert',
    timestamps: { created: '2026-03-08T10:00:00.000Z' },
    timeline: [],
  },
  {
    id: 'INC-002',
    title: 'DB connection pool exhaustion',
    description: 'Postgres maxed out',
    severity: 'P1',
    status: 'Investigating',
    affectedServices: ['postgres-primary'],
    detectionSource: 'alert',
    timestamps: { created: '2026-03-08T11:00:00.000Z', acknowledged: '2026-03-08T11:30:00.000Z' },
    timeline: [],
  },
  {
    id: 'INC-003',
    title: 'TLS cert expired',
    description: 'Cert expired',
    severity: 'P3',
    status: 'Resolved',
    affectedServices: ['web-prod-01'],
    detectionSource: 'alert',
    timestamps: { created: '2026-03-07T08:00:00.000Z', resolved: '2026-03-07T10:00:00.000Z' },
    timeline: [],
  },
]

const setIncidents = vi.fn()

beforeEach(() => {
  registeredTools.length = 0
  registeredRenderers.length = 0
  setIncidents.mockClear()
  render(<CounterController incidents={mockIncidents} setIncidents={setIncidents} />)
})

describe('CounterController tool registrations', () => {
  it('registers all expected frontend tools', () => {
    const names = registeredTools.map(a => a.name)
    expect(names).toContain('resolveIncident')
    expect(names).toContain('clearAllIncidents')
    expect(names).toContain('updateIncidentStatus')
    expect(names).toContain('addIncidentComment')
    expect(names).toContain('reportIncident')
    expect(names).toContain('analyzeIncident')
    expect(names).toContain('generateChart')
  })

  it('registers a separate render hook for generateChart', () => {
    const names = registeredRenderers.map(r => r.name)
    expect(names).toContain('generateChart')
    expect(registeredRenderers).toHaveLength(1)
  })

  it('passes incidents as a dependency to every frontend tool', () => {
    for (const tool of registeredTools) {
      expect(tool.deps).toEqual([mockIncidents])
    }
  })

  it('passes incidents as a dependency to the render hook', () => {
    for (const renderer of registeredRenderers) {
      expect(renderer.deps).toEqual([mockIncidents])
    }
  })
})

describe('generateChart tool', () => {
  function getChartTool() {
    return registeredTools.find(a => a.name === 'generateChart')!
  }

  function getChartRenderer() {
    return registeredRenderers.find(a => a.name === 'generateChart')!
  }

  it('tool handler does NOT have a render prop (render is separate)', () => {
    const chart = getChartTool()
    expect(chart.tool.render).toBeUndefined()
  })

  it('renderer has a render function', () => {
    const renderer = getChartRenderer()
    expect(typeof renderer.tool.render).toBe('function')
  })

  it('handler returns severity summary with correct counts', async () => {
    const chart = getChartTool()
    const handler = chart.tool.handler as (args: { chartType: string }) => Promise<string>
    const result = await handler({ chartType: 'severity' })
    expect(result).toContain('3 incidents')
    expect(result).toContain('P0: 1')
    expect(result).toContain('P1: 1')
    expect(result).toContain('P3: 1')
  })

  it('handler returns status summary with correct counts', async () => {
    const chart = getChartTool()
    const handler = chart.tool.handler as (args: { chartType: string }) => Promise<string>
    const result = await handler({ chartType: 'status' })
    expect(result).toContain('3 incidents')
    expect(result).toContain('Open: 1')
    expect(result).toContain('Investigating: 1')
    expect(result).toContain('Resolved: 1')
  })

  it('handler returns timeline summary', async () => {
    const chart = getChartTool()
    const handler = chart.tool.handler as (args: { chartType: string }) => Promise<string>
    const result = await handler({ chartType: 'timeline' })
    expect(result).toContain('Timeline of 3 incidents')
  })

  it('handler returns services summary', async () => {
    const chart = getChartTool()
    const handler = chart.tool.handler as (args: { chartType: string }) => Promise<string>
    const result = await handler({ chartType: 'services' })
    expect(result).toContain('Top affected services')
  })

  it('handler rejects invalid chart types', async () => {
    const chart = getChartTool()
    const handler = chart.tool.handler as (args: { chartType: string }) => Promise<string>
    const result = await handler({ chartType: 'invalid' })
    expect(result).toContain('Invalid chart type')
    expect(result).toContain('severity, status, timeline, services')
  })

  it('render returns loading state for executing status', () => {
    const renderer = getChartRenderer()
    const renderFn = renderer.tool.render as (props: Record<string, unknown>) => JSX.Element
    const element = renderFn({ status: 'executing', args: { chartType: 'severity' } })
    const { container } = render(element)
    expect(container.textContent).toContain('Generating chart')
  })

  it('render returns loading state for inProgress status', () => {
    const renderer = getChartRenderer()
    const renderFn = renderer.tool.render as (props: Record<string, unknown>) => JSX.Element
    const element = renderFn({ status: 'inProgress', args: { chartType: 'severity' } })
    const { container } = render(element)
    expect(container.textContent).toContain('Generating chart')
  })

  it('render returns severity chart for complete status', () => {
    const renderer = getChartRenderer()
    const renderFn = renderer.tool.render as (props: Record<string, unknown>) => JSX.Element
    const element = renderFn({ status: 'complete', args: { chartType: 'severity' }, result: '' })
    const { container } = render(element)
    expect(container.textContent).toContain('Incidents by Severity')
  })

  it('render returns status chart for complete status', () => {
    const renderer = getChartRenderer()
    const renderFn = renderer.tool.render as (props: Record<string, unknown>) => JSX.Element
    const element = renderFn({ status: 'complete', args: { chartType: 'status' }, result: '' })
    const { container } = render(element)
    expect(container.textContent).toContain('Incidents by Status')
  })

  it('render returns timeline chart for complete status', () => {
    const renderer = getChartRenderer()
    const renderFn = renderer.tool.render as (props: Record<string, unknown>) => JSX.Element
    const element = renderFn({ status: 'complete', args: { chartType: 'timeline' }, result: '' })
    const { container } = render(element)
    expect(container.textContent).toContain('Incident Timeline')
  })

  it('render returns services chart for complete status', () => {
    const renderer = getChartRenderer()
    const renderFn = renderer.tool.render as (props: Record<string, unknown>) => JSX.Element
    const element = renderFn({ status: 'complete', args: { chartType: 'services' }, result: '' })
    const { container } = render(element)
    expect(container.textContent).toContain('Most Affected Services')
  })

  it('render falls back to severity chart for unknown chart type', () => {
    const renderer = getChartRenderer()
    const renderFn = renderer.tool.render as (props: Record<string, unknown>) => JSX.Element
    const element = renderFn({ status: 'complete', args: { chartType: 'unknown' }, result: '' })
    const { container } = render(element)
    expect(container.textContent).toContain('Incidents by Severity')
  })
})

describe('resolveIncident tool', () => {
  function getAction() {
    return registeredTools.find(a => a.name === 'resolveIncident')!
  }

  it('resolves the most recent open incident when no ID given', async () => {
    const handler = getAction().tool.handler as (args: { incidentId?: string }) => Promise<string>
    const result = await handler({})
    expect(result).toContain('API outage')
    expect(setIncidents).toHaveBeenCalled()
  })

  it('resolves a specific incident by ID', async () => {
    const handler = getAction().tool.handler as (args: { incidentId?: string }) => Promise<string>
    const result = await handler({ incidentId: 'INC-002' })
    expect(result).toContain('DB connection pool exhaustion')
  })

  it('returns message when no open incidents', async () => {
    registeredTools.length = 0
    registeredRenderers.length = 0
    render(<CounterController incidents={[{ ...mockIncidents[2] }]} setIncidents={setIncidents} />)
    const handler = registeredTools.find(a => a.name === 'resolveIncident')!.tool.handler as (args: { incidentId?: string }) => Promise<string>
    const result = await handler({})
    expect(result).toContain('No open incidents')
  })
})
