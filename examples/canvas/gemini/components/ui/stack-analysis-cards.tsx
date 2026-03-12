import React, { useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  BookOpen,
  Box,
  Database,
  GitBranch,
  ListChecks,
  Server,
  Shield,
  Wrench,
  FileText,
} from "lucide-react"

// Types describing the expected analysis payload
export interface StackSection {
  framework?: string
  language?: string
  package_manager?: string
  styling?: string
  dependency_manager?: string
  architecture?: string
  key_libraries?: string[]
  [key: string]: unknown
}

export interface RootFileEntry { file: string; description: string }
export interface RiskNote { area: string; note: string }

export interface StackAnalysis {
  purpose?: string
  frontend?: StackSection
  backend?: StackSection
  database?: { type?: string; notes?: string }
  infrastructure?: { hosting_frontend?: string; hosting_backend?: string; dependencies?: string[] }
  ci_cd?: { setup?: string }
  key_root_files?: RootFileEntry[]
  how_to_run?: { summary?: string; steps?: string[] }
  risks_notes?: RiskNote[]
  [key: string]: unknown
}

function isNonEmptyArray<T>(arr: T[] | undefined | null): arr is T[] {
  return Array.isArray(arr) && arr.length > 0
}

function humanize(key: string): string {
  return key.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase())
}

function gridColsClass(count: number): string {
  if (count >= 3) return "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-stretch"
  if (count === 2) return "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6 items-stretch"
  return "grid grid-cols-1 gap-6 items-stretch"
}

function SectionCard({
  title,
  icon: Icon,
  children,
  className = "",
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={`bg-white/80 backdrop-blur-sm border-gray-200/50 shadow-sm h-full ${className}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center">
            <Icon className="w-4 h-4 text-white" />
          </div>
          <CardTitle className="text-base font-semibold text-gray-900">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-gray-800 leading-relaxed">{children}</CardContent>
    </Card>
  )
}

function DefinitionList({ data, order }: { data?: Record<string, unknown>; order?: string[] }) {
  if (!data) return null

  const entries = Object.entries(data).filter(([k, v]) => v !== undefined && v !== null && k !== "key_libraries")
  const orderedEntries = order
    ? entries.sort((a, b) => (order.indexOf(a[0]) - order.indexOf(b[0])))
    : entries

  return (
    <dl className="space-y-3">
      {orderedEntries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-3 gap-3">
          <dt className="col-span-1 text-gray-500">{humanize(key)}</dt>
          <dd className="col-span-2 font-medium text-gray-900 break-words hyphens-auto">{String(value)}</dd>
        </div>
      ))}
      {isNonEmptyArray((data as any).key_libraries) && (
        <div className="grid grid-cols-3 gap-3">
          <dt className="col-span-1 text-gray-500">Key Libraries</dt>
          <dd className="col-span-2">
            <div className="flex flex-wrap gap-1.5">
              {((data as any).key_libraries as string[]).map((lib) => (
                <Badge key={lib} variant="secondary" className="bg-gray-100 border border-gray-200 text-gray-900">
                  {lib}
                </Badge>
              ))}
            </div>
          </dd>
        </div>
      )}
    </dl>
  )
}

export function StackAnalysisCards({ analysis }: { analysis?: StackAnalysis | string }) {
  useEffect(() => {
    console.log(analysis, "analysis")
  }, [analysis])
  // Accept either object or JSON string
  let parsed: StackAnalysis | undefined
  if (!analysis) parsed = undefined
  else if (typeof analysis === "string") {
    try {
      parsed = JSON.parse(analysis) as StackAnalysis
    } catch {
      parsed = undefined
    }
  } else {
    parsed = analysis
  }

  if (!parsed || Object.keys(parsed).length === 0) {
    return (
      <div className="text-center text-gray-500 py-16">
        No analysis available yet. Ask the agent to analyze a repository.
      </div>
    )
  }

  const topCards = [parsed.frontend, parsed.backend, parsed.database, parsed.infrastructure, parsed.ci_cd].filter(Boolean)
  const bottomCardsCount = [isNonEmptyArray(parsed.key_root_files), Boolean(parsed.how_to_run), isNonEmptyArray(parsed.risks_notes)].filter(Boolean).length

  return (
    <div className="space-y-6">
      {parsed.purpose && (
        <SectionCard title="Purpose" icon={BookOpen}>
          <p className="leading-relaxed text-gray-800">{parsed.purpose}</p>
        </SectionCard>
      )}

      <div className={gridColsClass(topCards.length)}>
        {parsed.frontend && (
          <SectionCard title="Frontend" icon={Box}>
            <DefinitionList
              data={parsed.frontend as Record<string, unknown>}
              order={["language", "framework", "package_manager", "styling"]}
            />
          </SectionCard>
        )}
        {parsed.backend && (
          <SectionCard title="Backend" icon={Server}>
            <DefinitionList
              data={parsed.backend as Record<string, unknown>}
              order={["language", "framework", "dependency_manager", "architecture"]}
            />
          </SectionCard>
        )}
        {parsed.database && (
          <SectionCard title="Database" icon={Database}>
            <DefinitionList
              data={parsed.database as Record<string, unknown>}
              order={["type", "notes"]}
            />
          </SectionCard>
        )}
        {parsed.infrastructure && (
          <SectionCard title="Infrastructure" icon={Wrench}>
            <DefinitionList
              data={parsed.infrastructure as Record<string, unknown>}
              order={["hosting_frontend", "hosting_backend"]}
            />
            {isNonEmptyArray(parsed.infrastructure?.dependencies) && (
              <div className="mt-3">
                <div className="mb-1 text-gray-500">Dependencies</div>
                <div className="flex flex-wrap gap-1.5">
                  {(parsed.infrastructure?.dependencies as string[]).map((dep) => (
                    <Badge key={dep} variant="secondary" className="bg-gray-100 border border-gray-200 text-gray-900">
                      {dep}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>
        )}
        {parsed.ci_cd && (
          <SectionCard title="CI / CD" icon={GitBranch}>
            <DefinitionList data={parsed.ci_cd as Record<string, unknown>} order={["setup"]} />
          </SectionCard>
        )}
      </div>

      {(isNonEmptyArray(parsed.key_root_files) || parsed.how_to_run || isNonEmptyArray(parsed.risks_notes)) && (
        <div className={gridColsClass(bottomCardsCount)}>
          {isNonEmptyArray(parsed.key_root_files) && (
            <SectionCard title="Key Root Files" icon={FileText} className="lg:col-span-1">
              <ScrollArea className="h-56 pr-2">
                <div className="space-y-3">
                  {parsed.key_root_files!.map((f) => (
                    <div key={f.file} className="border rounded-md p-2.5 bg-white/70">
                      <div className="font-mono text-[13px] font-semibold text-gray-900 break-words">{f.file}</div>
                      <div className="text-xs text-gray-600 mt-1 leading-relaxed">{f.description}</div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </SectionCard>
          )}

          {parsed.how_to_run && (
            <SectionCard title="How To Run" icon={ListChecks} className="lg:col-span-1">
              {parsed.how_to_run?.summary && (
                <p className="mb-3 text-gray-800 leading-relaxed">{parsed.how_to_run.summary}</p>
              )}
              {isNonEmptyArray(parsed.how_to_run?.steps) && (
                <ol className="list-decimal list-inside space-y-2 text-gray-800">
                  {parsed.how_to_run!.steps!.map((step, idx) => (
                    <li key={idx} className="break-words hyphens-auto">{step}</li>
                  ))}
                </ol>
              )}
            </SectionCard>
          )}

          {isNonEmptyArray(parsed.risks_notes) && (
            <SectionCard title="Risks & Notes" icon={Shield} className="lg:col-span-1">
              <ScrollArea className="h-56 pr-2">
                <div className="space-y-3">
                  {parsed.risks_notes!.map((r, idx) => (
                    <div key={`${r.area}-${idx}`} className="border rounded-md p-2.5 bg-white/70">
                      <div className="text-sm font-semibold text-gray-900">{r.area}</div>
                      <div className="text-xs text-gray-600 mt-1 leading-relaxed break-words hyphens-auto">{r.note}</div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </SectionCard>
          )}
        </div>
      )}
    </div>
  )
}

export default StackAnalysisCards 