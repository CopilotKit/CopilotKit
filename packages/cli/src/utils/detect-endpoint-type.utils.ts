export enum RemoteEndpointType {
  LangGraphPlatform = "LangGraphPlatform",
  CopilotKit = "CopilotKit",
  CrewAI = "CrewAI",
  MCP = "MCP",
  Invalid = "Invalid",
}

const removeTrailingSlash = (url: string) => url.replace(/\/$/, "");

export const getHumanReadableEndpointType = (type: RemoteEndpointType) => {
  switch (type) {
    case RemoteEndpointType.LangGraphPlatform:
      return "LangGraph Platform";
    case RemoteEndpointType.CopilotKit:
      return "CopilotKit";
    case RemoteEndpointType.CrewAI:
      return "CrewAI";
    case RemoteEndpointType.MCP:
      return "MCP";
    default:
      return "Invalid";
  }
};

export async function detectRemoteEndpointType(url: string): Promise<{
  url: string;
  type: RemoteEndpointType;
  humanReadableType: string;
}> {
  // First check base URL
  const [isLangGraph, isLangGraphFastAPI, isCopilot, isCrewAI, isMCP] =
    await Promise.all([
      isLangGraphPlatformEndpoint(url),
      isLangGraphFastAPIEndpoint(url),
      isCopilotKitEndpoint(url),
      isCrewAIEndpoint(url),
      isMCPEndpoint(url),
    ]);

  // Check base endpoints first
  if (isLangGraph || isLangGraphFastAPI) {
    return {
      url,
      type: RemoteEndpointType.LangGraphPlatform,
      humanReadableType: "LangGraph Platform",
    };
  }

  if (isCopilot) {
    return {
      url,
      type: RemoteEndpointType.CopilotKit,
      humanReadableType: "CopilotKit",
    };
  }

  if (isCrewAI) {
    return {
      url,
      type: RemoteEndpointType.CrewAI,
      humanReadableType: "CrewAI",
    };
  }

  if (isMCP) {
    return {
      url,
      type: RemoteEndpointType.MCP,
      humanReadableType: "MCP",
    };
  }

  // If no match and URL doesn't already end with /copilotkit, try that path
  if (!url.endsWith("/copilotkit")) {
    const copilotKitUrl = `${removeTrailingSlash(url)}/copilotkit`;
    const isCopilotWithPath = await isCopilotKitEndpoint(copilotKitUrl);

    if (isCopilotWithPath) {
      return {
        url: copilotKitUrl,
        type: RemoteEndpointType.CopilotKit,
        humanReadableType: "CopilotKit",
      };
    }
  }

  return {
    url,
    type: RemoteEndpointType.Invalid,
    humanReadableType: "Invalid",
  };
}

async function isLangGraphPlatformEndpoint(
  url: string,
  retries: number = 0,
): Promise<boolean> {
  let response;

  try {
    response = await fetch(`${url}/assistants/search`, {
      method: "POST",

      body: JSON.stringify({
        metadata: {},
        limit: 99,
        offset: 0,
      }),
    });
  } catch (error) {
    return false;
  }

  if (!response.ok) {
    if (response.status === 502) {
      if (retries < 3) {
        console.log("RETRYING LGC", retries + 1);
        return isLangGraphPlatformEndpoint(url, retries + 1);
      }
    }

    if (response.status === 403) {
      return true;
    }

    return false;
  }

  const data = await response.json();

  if (data[0].assistant_id) {
    return true;
  }

  return false;
}

async function isLangGraphFastAPIEndpoint(url: string): Promise<boolean> {
  let response;

  try {
    response = await fetch(`${url}/health`, {
      method: "GET",
    });
  } catch (error) {
    return false;
  }

  return response.ok;
}

async function isCopilotKitEndpoint(
  url: string,
  retries: number = 0,
): Promise<boolean> {
  let response;

  try {
    response = await fetch(`${url}/info`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch (error) {
    return false;
  }

  if (!response.ok) {
    if (response.status === 502) {
      if (retries < 3) {
        console.log("RETRYING CK", retries + 1);
        return isCopilotKitEndpoint(url, retries + 1);
      }
    }

    return false;
  }

  const data = await response.json();

  if (data.agents && data.actions) {
    return true;
  }

  return false;
}

async function isCrewAIEndpoint(url: string): Promise<boolean> {
  return url.toLowerCase().includes("crew");
}

async function isMCPEndpoint(_url: string): Promise<boolean> {
  return true;
}
