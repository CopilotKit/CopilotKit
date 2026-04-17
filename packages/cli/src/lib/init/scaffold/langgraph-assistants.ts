export type LangGraphAgent = {
  assistant_id: string;
  graph_id: string;
  config: {
    tags: string[];
    recursion_limit: number;
    configurable: Record<string, any>;
  };
  created_at: string;
  updated_at: string;
  metadata: Record<string, any>;
  version: number;
  name: string;
  description: string;
};

export async function getLangGraphAgents(url: string, langSmithApiKey: string) {
  try {
    const response = await fetch(
      `${url.trim().replace(/\/$/, "")}/assistants/search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": langSmithApiKey,
        },
        body: JSON.stringify({
          limit: 100,
          offset: 0,
        }),
      },
    );

    return (await response.json()) as LangGraphAgent[];
  } catch (error) {
    throw new Error(`Failed to get LangGraph agents: ${error}`, {
      cause: error,
    });
  }
}
