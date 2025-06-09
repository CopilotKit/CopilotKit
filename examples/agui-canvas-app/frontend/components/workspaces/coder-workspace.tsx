"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Code, Play, FileText, Lightbulb, Bug } from "lucide-react"

interface CoderWorkspaceProps {
  content: string
  setContent: (content: string) => void
  lastMessage: string
  isAgentActive: boolean
}

export function CoderWorkspace({ content, setContent, lastMessage, isAgentActive }: CoderWorkspaceProps) {
  const [activeFile, setActiveFile] = useState("main.js")
  const [files] = useState([
    { name: "main.js", type: "javascript", content: "// Your main application code\nconsole.log('Hello World!');" },
    { name: "styles.css", type: "css", content: "/* Your styles here */\nbody { margin: 0; }" },
    { name: "README.md", type: "markdown", content: "# Project Documentation\n\nDescribe your project here..." },
  ])

  const [codeContent, setCodeContent] = useState(files[0].content)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
      {/* Code Editor */}
      <div className="lg:col-span-3 space-y-6">
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xl">Code Editor</CardTitle>
                <Badge variant="outline">{activeFile}</Badge>
              </div>
              {isAgentActive && (
                <Badge variant="default" className="gap-1 animate-pulse">
                  <Lightbulb className="h-3 w-3" />
                  Agent Coding
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="editor" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="editor">Editor</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="terminal">Terminal</TabsTrigger>
              </TabsList>

              <TabsContent value="editor" className="mt-4">
                <Textarea
                  value={codeContent}
                  onChange={(e) => setCodeContent(e.target.value)}
                  placeholder="Write your code here..."
                  className="min-h-[400px] resize-none font-mono text-sm border-0 p-4 bg-muted/30 focus-visible:ring-0"
                />
              </TabsContent>

              <TabsContent value="preview" className="mt-4">
                <div className="min-h-[400px] border rounded-lg bg-background p-4">
                  <p className="text-muted-foreground text-center">Preview will appear here</p>
                </div>
              </TabsContent>

              <TabsContent value="terminal" className="mt-4">
                <div className="min-h-[400px] border rounded-lg bg-black text-green-400 p-4 font-mono text-sm">
                  <p>$ npm start</p>
                  <p>Server running on http://localhost:3000</p>
                  <p className="animate-pulse">$ _</p>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Agent Code Suggestions */}
        {isAgentActive && lastMessage && (
          <Card className="rounded-2xl border-primary/20 bg-primary/5 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-primary" />
                Agent Code Review
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed font-mono bg-muted/50 p-3 rounded">{lastMessage}</p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline">
                  Apply Changes
                </Button>
                <Button size="sm" variant="outline">
                  Run Code
                </Button>
                <Button size="sm" variant="ghost">
                  Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* File Explorer & Tools */}
      <div className="space-y-6">
        {/* File Explorer */}
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Files</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              <div className="space-y-2">
                {files.map((file) => (
                  <Button
                    key={file.name}
                    variant={activeFile === file.name ? "default" : "ghost"}
                    className="w-full justify-start gap-2 h-8"
                    onClick={() => {
                      setActiveFile(file.name)
                      setCodeContent(file.content)
                    }}
                  >
                    <FileText className="h-3 w-3" />
                    {file.name}
                  </Button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Code Actions */}
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="outline" className="w-full justify-start gap-2">
              <Play className="h-4 w-4" />
              Run Code
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2">
              <Bug className="h-4 w-4" />
              Debug
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2">
              <Code className="h-4 w-4" />
              Format
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2">
              <Lightbulb className="h-4 w-4" />
              Get Help
            </Button>
          </CardContent>
        </Card>

        {/* Code Stats */}
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span>Lines</span>
              <span>{codeContent.split("\n").length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Characters</span>
              <span>{codeContent.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Language</span>
              <span>JavaScript</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
