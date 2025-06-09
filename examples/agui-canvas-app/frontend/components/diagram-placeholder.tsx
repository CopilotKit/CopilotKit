"use client"

import type { AgentType } from "@/lib/types"

interface DiagramPlaceholderProps {
  selectedAgent: AgentType
}

export function DiagramPlaceholder({ selectedAgent }: DiagramPlaceholderProps) {
  // Sample Mermaid diagram code for each agent type
  const getDiagramCode = () => {
    switch (selectedAgent) {
      case "Researcher":
        return `graph TD
    A[User Query] --> B[Research Phase]
    B --> C{Sufficient Info?}
    C -->|Yes| D[Synthesize Findings]
    C -->|No| E[Deep Research]
    E --> B
    D --> F[Present Results]`

      case "Planner":
        return `graph TD
    A[User Request] --> B[Analyze Requirements]
    B --> C[Create Plan]
    C --> D[Prioritize Tasks]
    D --> E[Set Timeline]
    E --> F[Present Plan]`

      case "Coder":
        return `graph TD
    A[Code Request] --> B[Parse Requirements]
    B --> C[Design Solution]
    C --> D[Write Code]
    D --> E[Test Code]
    E --> F[Optimize]
    F --> G[Present Solution]`
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 p-6">
      <div className="mb-5 text-sm text-muted-foreground">
        Mermaid.js Diagram Placeholder - In a real implementation, this would render:
      </div>
      <pre className="overflow-x-auto rounded-xl bg-muted p-5 text-sm">{getDiagramCode()}</pre>
      <div className="mt-5 text-center text-sm text-muted-foreground">
        (Visualization would appear here when connected to Mermaid.js)
      </div>
    </div>
  )
}
