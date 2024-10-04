"use client";

import { useState } from "react";
import { useLocalStorage } from "usehooks-ts";

export function SelectLLMProvider() {
  const [llmProvider, setLLMProvider] = useLocalStorage<string | null>("llmProvider", "openai");
  // const [llmProvider, setLLMProvider] = useState<string | null>("openai");

  return (
    <div className="flex gap-2">
      <button onClick={() => setLLMProvider("openai")} className={`${llmProvider === "openai" ? "bg-blue-500" : "bg-gray-200"}`}>OpenAI</button>
      <button onClick={() => setLLMProvider("anthropic")} className={`${llmProvider === "anthropic" ? "bg-blue-500" : "bg-gray-200"}`}>Anthropic</button>
    </div>
  )
}