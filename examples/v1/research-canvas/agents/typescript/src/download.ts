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

/** Returns fetched document text even when it cannot remain in the bounded cache. */
export async function downloadResource(url: string): Promise<string> {
  return getOrLoadResource(url, () =>
    withAbortTimeout(5000, async (signal) => {
      const htmlContent = await fetchPublicText(url, signal);
      return htmlToText(htmlContent);
    }),
  );
}

export async function download_node(state: AgentState, config: RunnableConfig) {
  let resources = (state["resources"] || []).map((resource) =>
    getCachedResource(resource.url) !== undefined
      ? { ...resource, downloaded: true }
      : resource,
  );
  const logs = [...(state["logs"] || [])];

  const resourcesToDownload = [];

  const logsOffset = logs.length;

  // Find resources that are not downloaded
  for (const resource of resources) {
    if (getCachedResource(resource.url) === undefined) {
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
      resources = resources.map((item) =>
        item.url === resource.url ? { ...item, downloaded: true } : item,
      );
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failure.message = `Failed to download ${resource.url}: ${failure.message}`;
      logs[logsOffset + i]["message"] = failure.message;
      if (resource.downloaded) {
        await copilotkitEmitState(config, { ...restOfState, resources, logs });
        throw failure;
      }
      // A failed first download must not be retried on every later turn.
      resources = resources.filter((item) => item.url !== resource.url);
    }
    logs[logsOffset + i]["done"] = true;
    await copilotkitEmitState(config, { ...restOfState, resources, logs });
  }
  return {
    resources,
    logs,
  };
}
