"use client";

import { useSearchParams } from "next/navigation";

export function ServiceAdapterSelector() {
  const searchParams = useSearchParams();
  const serviceAdapter = searchParams.get("serviceAdapter") || "openai";

  if (searchParams.has("publicApiKey")) {
    return null;
  }

  const handleChange = (e) => {
    const value = e.target.value;
    const url = new URL(window.location.href);
    url.searchParams.set("serviceAdapter", value);
    window.location.href = url.toString();
  };

  return (
    <div className="fixed bottom-0 p-4 z-50">
      <div className="bg-white shadow-md border-black/50 border p-2 rounded-md text-black">
        <select value={serviceAdapter} onChange={handleChange}>
          <option value="openai">OpenAI</option>
          <option value="azure_openai">Azure OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Gemini</option>
          {/* <option value="azure">Azure</option> */}
          <option value="langchain_openai">LangChain (OpenAI)</option>
          <option value="langchain_anthropic">LangChain (Anthropic)</option>
          <option value="groq">Groq</option>
          <option value="bedrock">Amazon Bedrock</option>
        </select>
      </div>
    </div>
  );
}
