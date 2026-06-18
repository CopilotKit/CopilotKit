import { defineTool } from "@copilotkit/runtime/v2";
import type { ToolDefinition } from "@copilotkit/runtime/v2";
import { z } from "zod";
import { listDir, readFile, searchFiles } from "./fs-tools";

/**
 * Returns a set of read-only filesystem tools scoped to `root`.
 * All path security is delegated to the underlying fs-tools helpers,
 * which call `resolveInWorkspace` to prevent escaping the root.
 */
export function createReadOnlyFsTools(root: string): ToolDefinition[] {
  const fsListTool = defineTool({
    name: "fs_list",
    description:
      "List the files and directories at a given path within the workspace.",
    parameters: z.object({
      path: z.string(),
    }),
    execute: async ({ path }) => ({ entries: await listDir(root, path) }),
  });

  const fsReadTool = defineTool({
    name: "fs_read",
    description: "Read the text content of a file within the workspace.",
    parameters: z.object({
      path: z.string(),
    }),
    execute: async ({ path }) => ({ content: await readFile(root, path) }),
  });

  const fsSearchTool = defineTool({
    name: "fs_search",
    description:
      "Search for files whose names contain the given query string within the workspace.",
    parameters: z.object({
      query: z.string(),
    }),
    execute: async ({ query }) => ({
      matches: await searchFiles(root, query),
    }),
  });

  return [fsListTool, fsReadTool, fsSearchTool];
}
