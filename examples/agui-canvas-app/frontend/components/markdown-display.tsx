"use client"

import { useEffect, useState } from "react"
import { Markdown } from "@copilotkit/react-ui"
interface MarkdownDisplayProps {
  content: string
}

export function MarkdownDisplay({ content }: MarkdownDisplayProps) {
  return (
    <Markdown content={content} />
  )
}
