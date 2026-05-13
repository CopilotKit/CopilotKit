async function load() {
  const { LangChainAdapter } = await import("@copilotkit/runtime/langchain");
  return new LangChainAdapter();
}

load().then(console.log);
