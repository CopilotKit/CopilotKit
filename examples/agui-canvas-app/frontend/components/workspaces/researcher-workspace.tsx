"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, Plus, BookOpen, ExternalLink, Lightbulb, X } from "lucide-react"
import { MarkdownDisplay } from "../markdown-display"

interface ResearcherWorkspaceProps {
  content: string
  setContent: (content: string) => void
  lastMessage: string
  isAgentActive: boolean
  setSources: (sources: { title: string, url: string, description: string }[]) => void
  sources: { title: string, url: string, description: string }[]
}

export function ResearcherWorkspace({ content, setContent, lastMessage, isAgentActive, sources, setSources }: ResearcherWorkspaceProps) {
  // const [sources, setSources] = useState(initialSources)
  const [showAddSource, setShowAddSource] = useState(false)
  const [newSource, setNewSource] = useState({ title: "", url: "", description: "" })

  const [findings] = useState([
    "AI adoption has increased 300% in the last year",
    "Key challenges include data privacy and model interpretability",
    "Most successful implementations focus on specific use cases",
  ])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-16">
      {/* Main Research Document */}
      <div className="lg:col-span-2 space-y-6">
        <Card className="rounded-2xl shadow-sm max-h-[calc(100vh-64px)] overflow-y-auto">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xl">Research Document</CardTitle>
              {isAgentActive && (
                <Badge variant="default" className="gap-1 animate-pulse">
                  <Lightbulb className="h-3 w-3" />
                  Agent Contributing
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="min-h-[500px]">
            <MarkdownDisplay content={content} />
          </CardContent>
        </Card>

        {/* Agent Suggestions */}
        {isAgentActive && lastMessage && (
          <Card className="rounded-2xl border-primary/20 bg-primary/5 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-primary" />
                Agent Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{lastMessage}</p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline">
                  Apply Suggestion
                </Button>
                <Button size="sm" variant="ghost">
                  Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Research Tools Sidebar */}
      <div className="space-y-6 lg:sticky lg:self-start">
        {/* Sources */}
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Sources</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setShowAddSource((v) => !v)}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {showAddSource && (
              <form
                className="mt-4 space-y-2"
                onSubmit={e => {
                  e.preventDefault()
                  if (newSource.title && newSource.url && newSource.description) {
                    setSources([...sources, newSource])
                    setNewSource({ title: "", url: "", description: "" })
                    setShowAddSource(false)
                  }
                }}
              >
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  placeholder="Title"
                  value={newSource.title}
                  onChange={e => setNewSource({ ...newSource, title: e.target.value })}
                  required
                />
                <input
                  className="w-full border rounded px-2 py-1 text-sm"
                  placeholder="URL"
                  value={newSource.url}
                  onChange={e => setNewSource({ ...newSource, url: e.target.value })}
                  required
                />
                <textarea
                  className="w-full border rounded px-2 py-1 text-sm"
                  placeholder="Description"
                  value={newSource.description}
                  onChange={e => setNewSource({ ...newSource, description: e.target.value })}
                  required
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" variant="default">Add Source</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddSource(false)}>Cancel</Button>
                </div>
              </form>
            )}
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[350px]">
              <div className="space-y-3">
                {sources.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">No sources to show</div>
                ) : (
                  sources.map((source, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-3 p-3 rounded-lg border bg-white hover:bg-muted transition-colors relative"
                    >
                      <BookOpen className="h-4 w-4 mt-1 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium mb-2 break-words">{source.title}</p>
                        <div className="text-xs text-muted-foreground bg-muted/60 rounded-lg p-2 leading-snug shadow-inner w-full break-words">
                          {source.description}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 items-end ml-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          asChild
                        >
                          <a href={source.url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-destructive opacity-70 hover:opacity-100"
                          onClick={() => setSources(sources.filter((_, i) => i !== index))}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Key Findings */}
        {/* <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Key Findings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {findings.map((finding, index) => (
                <div key={index} className="p-3 rounded-lg bg-muted/50">
                  <p className="text-sm">{finding}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card> */}

        {/* Quick Actions */}
        {/* <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start gap-2">
              <Search className="h-4 w-4" />
              Search for Sources
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2">
              <BookOpen className="h-4 w-4" />
              Generate Summary
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2">
              <Lightbulb className="h-4 w-4" />
              Get Insights
            </Button>
          </CardContent>
        </Card> */}
      </div>
    </div>
  )
}
