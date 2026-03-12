
export function extractJsonFromMarkdown(markdown: string): any[] {
  const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/g;
  const matches = [...markdown.matchAll(jsonBlockRegex)];
  const results: any[] = [];

  for (const match of matches) {
    if (match[1]) {
      const content = match[1].trim();
      // Try parsing as a single JSON object first
      try {
        results.push(JSON.parse(content));
      } catch (error) {
        // If that fails, try parsing as JSONL (line by line)
        const lines = content.split("\n");
        for (const line of lines) {
          if (line.trim()) {
            try {
              results.push(JSON.parse(line));
            } catch (e2) {
              // Ignore invalid lines
            }
          }
        }
      }
    }
  }
  return results;
}
