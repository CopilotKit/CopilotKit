import { Action } from "@copilotkit/shared";
import { RemoteChain } from "../types";
import { RemoteRunnable } from "langchain/runnables/remote";

export async function remoteChainToAction(chain: RemoteChain): Promise<Action<any>> {
  chain = { ...chain };
  const runnable = new RemoteRunnable({ url: chain.chainUrl });

  if (!chain.parameters) {
    chain = await inferLangServeParameters(chain);
  }

  chain.parameterType ||= "multi";

  return {
    name: chain.name,
    description: chain.description,
    parameters: chain.parameters!,
    handler: async (args: any) => {
      let input: any;
      if (chain.parameterType === "single") {
        input = args[Object.keys(args)[0]];
      } else {
        input = args;
      }
      return await runnable.invoke(input);
    },
  };
}

export async function inferLangServeParameters(chain: RemoteChain): Promise<RemoteChain> {
  chain = { ...chain };

  const supportedTypes = ["string", "number", "boolean"];

  let schemaUrl = chain.chainUrl.replace(/\/+$/, "") + "/input_schema";
  let schema = await fetch(schemaUrl)
    .then((res) => res.json())
    .catch(() => {
      throw new Error("Failed to fetch langserve schema at " + schemaUrl);
    });
  // for now, don't use json schema, just do a simple conversion

  if (supportedTypes.includes(schema.type)) {
    chain.parameterType = "single";
    chain.parameters = [
      {
        name: "input",
        type: schema.type,
        description: "The input to the chain",
      },
    ];
  } else if (schema.type === "object") {
    chain.parameterType = "multi";
    chain.parameters = Object.keys(schema.properties).map((key) => {
      let property = schema.properties[key];
      if (!supportedTypes.includes(property.type)) {
        throw new Error("Unsupported schema type");
      }
      return {
        name: key,
        type: property.type,
        description: property.description || "",
        required: schema.required?.includes(key) || false,
      };
    });
  } else {
    throw new Error("Unsupported schema type");
  }

  return chain;
}
