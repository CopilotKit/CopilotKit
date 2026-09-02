/**
 * Download Node
 *
 * This module contains the implementation of the download_node function.
 */

import type { RunnableConfig } from "@langchain/core/runnables";
import type { AgentState } from "./state";
import { htmlToText } from "html-to-text";
import { copilotkitEmitState } from "@copilotkit/sdk-js/langgraph";
import { withAbortTimeout } from "./abort-timeout";
import { fetchPublicText } from "./public-url-fetch";
import { getCachedResource, getOrLoadResource } from "./resource-cache";

export function getResource(url: string): string {
  return getCachedResource(url) ?? "";
}

async function downloadResource(url: string): Promise<string> {
  return getOrLoadResource(url, () =>
    withAbortTimeout(5000, async (signal) => {
      const htmlContent = await fetchPublicText(url, signal);
      return htmlToText(htmlContent);
    }),
  );
}

export async function download_node(state: AgentState, config: RunnableConfig) {
  const resources = state["resources"] || [];
  const logs = state["logs"] || [];

  const resourcesToDownload = [];

  const logsOffset = logs.length;

  // Find resources that are not downloaded
  for (const resource of resources) {
    if (!getResource(resource.url)) {
      resourcesToDownload.push(resource);
      logs.push({
        message: `Downloading ${resource.url}`,
        done: false,
      });
    }
  }

  // Emit the state to let the UI update
  const { messages, ...restOfState } = state;
  await copilotkitEmitState(config, {
    ...restOfState,
    resources,
    logs,
  });

  // Download the resources
  for (let i = 0; i < resourcesToDownload.length; i++) {
    const resource = resourcesToDownload[i];
    try {
      await downloadResource(resource.url);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failure.message = `Failed to download ${resource.url}: ${failure.message}`;
      logs[logsOffset + i]["message"] = failure.message;
      await copilotkitEmitState(config, state);
      throw failure;
    }
    logs[logsOffset + i]["done"] = true;
    await copilotkitEmitState(config, state);
  }
  return {
    resources,
    logs,
  };
}
