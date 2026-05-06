async function load() {
  const { LangChainAdapter } = await import("@copilotkit/runtime");
  return new LangChainAdapter();
}

load().then(console.log);
