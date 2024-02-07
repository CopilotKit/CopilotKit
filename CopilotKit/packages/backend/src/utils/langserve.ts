import { AnnotatedFunction } from "@copilotkit/shared";
import { RemoteChain } from "../types";
import { RemoteRunnable } from "langchain/runnables/remote";

export async function remoteChainToAnnotatedFunction(
  chain: RemoteChain,
): Promise<AnnotatedFunction<any[]>> {
  chain = { ...chain };
  const runnable = new RemoteRunnable({ url: chain.chainUrl });

  if (!chain.argumentAnnotations) {
    chain = await inferLangServeParameters(chain);
  }

  chain.callType ||= "invoke";
  chain.argumentType ||= "multi";

  return {
    name: chain.name,
    description: chain.description,
    argumentAnnotations: chain.argumentAnnotations!,
    implementation: async (...args: any[]) => {
      let input: any;
      if (chain.argumentType === "single") {
        input = args[0];
      } else {
        input = {};
        for (let i = 0; i < args.length; i++) {
          input[chain.argumentAnnotations![i].name] = args[i];
        }
      }
      if (chain.callType === "invoke") {
        return await runnable.invoke(input);
      } else if (chain.callType === "stream") {
        return runnable.stream(input);
      }
    },
  };
}

export async function inferLangServeParameters(chain: RemoteChain): Promise<RemoteChain> {
  chain = { ...chain };

  const supportedTypes = ["string", "number", "boolean"];

  let schemaUrl = chain.chainUrl.replace(/\/+$/, "") + "/input_schema";
  let schema = await fetch(schemaUrl).then((res) => res.json());
  // for now, don't use json schema, just do a simple conversion

  if (supportedTypes.includes(schema.type)) {
    chain.argumentType = "single";
    chain.argumentAnnotations = [
      {
        name: "input",
        type: schema.type,
        description: "The input to the chain",
        required: true,
      },
    ];
  } else if (schema.type === "object") {
    chain.argumentType = "multi";
    chain.argumentAnnotations = Object.keys(schema.properties).map((key) => {
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
