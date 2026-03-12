"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Copy, Play, Check } from "lucide-react"
import { toast } from "@/hooks/use-toast";

interface CodeSnippetProps {
  code: string
  language: string
  onExecute: () => void
}

export function CodeSnippet({ code, language, onExecute }: CodeSnippetProps) {
  const [isCopied, setIsCopied] = useState(false)

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(code)
    setIsCopied(true)
    toast({
      title: "'Copied to clipboard'",
      description: "'The code snippet has been copied to your clipboard.'",
    })
    setTimeout(() => setIsCopied(false), 2000)
  }

  return (
    <div className="relative rounded-lg border border-neutral-200 border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:border-neutral-800">
      <div className="flex items-center justify-between rounded-t-lg border-b border-gray-200 bg-gray-100 px-4 py-2 dark:border-gray-700 dark:bg-gray-700">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{language}</span>
        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={copyToClipboard}
            aria-label="Copy code to clipboard"
          >
            {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            <span className="ml-2 hidden sm:inline">{isCopied ? "'Copied'" : "'Copy'"}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onExecute}
            aria-label="Execute code"
          >
            <Play className="h-4 w-4" />
            <span className="ml-2 hidden sm:inline">Execute</span>
          </Button>
        </div>
      </div>
      <pre className="overflow-x-auto p-4">
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  )
}