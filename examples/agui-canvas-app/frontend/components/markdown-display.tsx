"use client"

import { useEffect, useState } from "react"

interface MarkdownDisplayProps {
  content: string
}

export function MarkdownDisplay({ content }: MarkdownDisplayProps) {
  const [formattedContent, setFormattedContent] = useState("")

  useEffect(() => {
    // Simple markdown formatting for demonstration
    // In a real app, you'd use a proper markdown parser like react-markdown
    const formatted = content
      .replace(/```(.+?)```/gs, '<pre class="bg-muted p-4 rounded-xl my-4 overflow-x-auto text-sm">$1</pre>')
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold my-4">$1</h1>')
      .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold my-3">$1</h2>')
      .replace(/^### (.+)$/gm, '<h3 class="text-lg font-bold my-2">$1</h3>')
      .replace(/\n/g, "<br />")

    setFormattedContent(formatted)
  }, [content])

  return (
    <div
      className="prose prose-lg max-w-none dark:prose-invert"
      dangerouslySetInnerHTML={{ __html: formattedContent }}
    />
  )
}
