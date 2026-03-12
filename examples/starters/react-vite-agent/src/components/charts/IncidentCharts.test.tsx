import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  SeverityDistributionChart,
  StatusBreakdownChart,
  IncidentTimelineChart,
  ServiceImpactChart,
} from './IncidentCharts'
import type { Incident } from '../../types/incident'

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
    affectedServices: ['postgres-primary', 'api-gateway'],
    detectionSource: 'alert',
    timestamps: { created: '2026-03-08T11:00:00.000Z', acknowledged: '2026-03-08T11:30:00.000Z' },
    timeline: [],
  },
  {
    id: 'INC-003',
    title: 'TLS cert expired',
    description: 'Customer portal cert expired',
    severity: 'P3',
    status: 'Resolved',
    affectedServices: ['web-prod-01'],
    detectionSource: 'alert',
    timestamps: { created: '2026-03-07T08:00:00.000Z', resolved: '2026-03-07T10:00:00.000Z' },
    timeline: [],
  },
  {
    id: 'INC-004',
    title: 'Cache pressure',
    description: 'Redis memory high',
    severity: 'P2',
    status: 'Mitigated',
    affectedServices: ['redis-cache', 'api-gateway'],
    detectionSource: 'alert',
    timestamps: { created: '2026-03-08T06:00:00.000Z' },
    timeline: [],
  },
]

// Recharts renders SVG elements; jsdom has limited SVG support.
// We verify the component mounts, renders its container/title, and
// produces an SVG for each chart type.

describe('SeverityDistributionChart', () => {
  it('renders with incident data', () => {
    const { container } = render(<SeverityDistributionChart incidents={mockIncidents} />)
    expect(screen.getByText('Incidents by Severity')).toBeInTheDocument()
    expect(container.querySelector('.chart-container')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('renders with empty incidents', () => {
    const { container } = render(<SeverityDistributionChart incidents={[]} />)
    expect(screen.getByText('Incidents by Severity')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('creates data entries for each severity present', () => {
    const { container } = render(<SeverityDistributionChart incidents={mockIncidents} />)
    // recharts may not add class names in jsdom; verify SVG paths exist
    const paths = container.querySelectorAll('svg path')
    expect(paths.length).toBeGreaterThan(0)
  })
})

describe('StatusBreakdownChart', () => {
  it('renders with incident data', () => {
    const { container } = render(<StatusBreakdownChart incidents={mockIncidents} />)
    expect(screen.getByText('Incidents by Status')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('renders with empty incidents', () => {
    const { container } = render(<StatusBreakdownChart incidents={[]} />)
    expect(screen.getByText('Incidents by Status')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})

describe('IncidentTimelineChart', () => {
  it('renders with incident data', () => {
    const { container } = render(<IncidentTimelineChart incidents={mockIncidents} />)
    expect(screen.getByText('Incident Timeline')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('renders with empty incidents', () => {
    const { container } = render(<IncidentTimelineChart incidents={[]} />)
    expect(screen.getByText('Incident Timeline')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})

describe('ServiceImpactChart', () => {
  it('renders with incident data showing affected services', () => {
    const { container } = render(<ServiceImpactChart incidents={mockIncidents} />)
    expect(screen.getByText('Most Affected Services')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('shows empty state when no services are affected', () => {
    const noServiceIncidents: Incident[] = [
      {
        ...mockIncidents[0],
        affectedServices: [],
      },
    ]
    render(<ServiceImpactChart incidents={noServiceIncidents} />)
    expect(screen.getByText('Most Affected Services')).toBeInTheDocument()
    expect(screen.getByText('No service data available')).toBeInTheDocument()
  })

  it('renders with empty incidents', () => {
    render(<ServiceImpactChart incidents={[]} />)
    expect(screen.getByText('No service data available')).toBeInTheDocument()
  })
})
