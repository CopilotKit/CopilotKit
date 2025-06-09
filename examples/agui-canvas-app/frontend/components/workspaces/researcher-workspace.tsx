"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Search, Plus, BookOpen, ExternalLink, Lightbulb } from "lucide-react"

interface ResearcherWorkspaceProps {
  content: string
  setContent: (content: string) => void
  lastMessage: string
  isAgentActive: boolean
}

export function ResearcherWorkspace({ content, setContent, lastMessage, isAgentActive }: ResearcherWorkspaceProps) {
  const [sources] = useState([
    { title: "AI Research Paper", url: "#", type: "Academic" },
    { title: "Industry Report", url: "#", type: "Report" },
    { title: "Expert Interview", url: "#", type: "Primary" },
  ])

  const [findings] = useState([
    "AI adoption has increased 300% in the last year",
    "Key challenges include data privacy and model interpretability",
    "Most successful implementations focus on specific use cases",
  ])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Main Research Document */}
      <div className="lg:col-span-2 space-y-6">
        <Card className="rounded-2xl shadow-sm">
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
          <CardContent>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Start your research here... The agent will help you gather information, analyze findings, and structure your research."
              className="min-h-[400px] resize-none border-0 p-0 text-base leading-relaxed focus-visible:ring-0"
            />
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
      <div className="space-y-6">
        {/* Sources */}
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Sources</CardTitle>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              <div className="space-y-3">
                {sources.map((source, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 rounded-lg border">
                    <BookOpen className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{source.title}</p>
                      <Badge variant="secondary" className="text-xs mt-1">
                        {source.type}
                      </Badge>
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Key Findings */}
        <Card className="rounded-2xl shadow-sm">
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
        </Card>

        {/* Quick Actions */}
        <Card className="rounded-2xl shadow-sm">
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
        </Card>
      </div>
    </div>
  )
}
