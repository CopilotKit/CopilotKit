type SearchLog = {
  message: string;
  done: boolean;
};

/** Adds progress entries for a search batch and tracks their completion. */
export function createSearchProgress(logs: SearchLog[], queries: string[]) {
  const logsOffset = logs.length;

  for (const query of queries) {
    logs.push({
      message: `Search for ${query}`,
      done: false,
    });
  }

  return {
    complete(queryIndex: number) {
      logs[logsOffset + queryIndex].done = true;
    },
  };
}
