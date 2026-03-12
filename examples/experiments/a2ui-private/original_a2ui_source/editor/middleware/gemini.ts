/*
 Copyright 2025 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import { IncomingMessage, ServerResponse } from "http";
import { Plugin, ViteDevServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { v0_8 } from "@a2ui/web-lib";
import { createA2UIPrompt, createImageParsePrompt } from "./prompts";

// TODO: Reenable.
// import ServerToClientMessage from "../schemas/a2ui-message.js";

let catalog: v0_8.Types.ClientCapabilitiesDynamic | null = null;
let ai: GoogleGenAI;
export const plugin = (): Plugin => {
  if (!("GEMINI_API_KEY" in process.env && process.env.GEMINI_KEY !== "")) {
    throw new Error("No GEMINI_API_KEY environment variable; add one to .env");
  }

  return {
    name: "custom-gemini-handler",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        "/a2ui",
        async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (!ai) {
            ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          }

          if (req.method === "POST") {
            let contents = "";

            req.on("data", (chunk) => {
              contents += chunk.toString();
            });

            req.on("end", async () => {
              try {
                const payload = JSON.parse(
                  contents
                ) as v0_8.Types.A2UIClientEventMessage;
                if (payload.clientUiCapabilities || payload.userAction) {
                  if (payload.clientUiCapabilities) {
                    if ("dynamicCatalog" in payload.clientUiCapabilities) {
                      catalog = payload.clientUiCapabilities.dynamicCatalog;

                      res.statusCode = 200;
                      res.setHeader("Content-Type", "application/json");
                      res.end(
                        JSON.stringify({
                          role: "model",
                          parts: [{ text: "Dynamic Catalog Received" }],
                        })
                      );
                      return;
                    }
                  } else if (payload.userAction) {
                    // TODO: Handle user actions.
                    return;
                  }
                } else {
                  // Other payload - assume this is a user request.
                  if (!payload.request || !catalog) {
                    res.statusCode = 400;
                    res.setHeader("Content-Type", "application/json");
                    res.end(
                      JSON.stringify({
                        error: `Invalid message - No payload or catalog`,
                      })
                    );
                    return;
                  }

                  if (v0_8.Data.Guards.isObject(payload.request)) {
                    const request = payload.request as {
                      imageData?: string;
                      instructions: string;
                    };

                    let imageDescription = "";
                    if (
                      request.imageData &&
                      request.imageData.startsWith("data:")
                    ) {
                      const mimeType = /data:(.*);/
                        .exec(request.imageData)
                        ?.at(1);
                      if (!mimeType) {
                        throw new Error("Invalid inline data");
                      }
                      const data = request.imageData.substring(
                        `data:${mimeType};base64,`.length
                      );
                      const contentPart = {
                        inlineData: {
                          mimeType,
                          data,
                        },
                      };

                      const prompt = createImageParsePrompt(
                        catalog,
                        contentPart
                      );
                      const modelResponse = await ai.models.generateContent({
                        model: "gemini-2.5-flash",
                        contents: prompt,
                        config: {
                          systemInstruction: `
                        You are working as part of an AI system, so no chit-chat and
                        no explaining what you're doing and why.DO NOT start with
                        "Okay", or "Alright" or any preambles. Just the output,
                        please.`,
                        },
                      });
                      imageDescription = modelResponse.text ?? "";
                    }

                    const prompt = createA2UIPrompt(
                      catalog,
                      imageDescription,
                      request.instructions
                    );

                    const modelResponse = await ai.models.generateContent({
                      model: "gemini-2.5-flash",
                      contents: prompt,
                      config: {
                        // responseMimeType: "application/json",
                        // responseJsonSchema: {
                        //   type: "array",
                        //   items: ServerToClientMessage,
                        // },
                        systemInstruction: `Please return a valid array
                        necessary to satisfy the user request. If no data is
                        provided create some. If there are any URLs you must
                        make them absolute and begin with a /.

                        Nothing should ever be loaded from a remote source.

                        You are working as part of an AI system, so no chit-chat and
                        no explaining what you're doing and why.DO NOT start with
                        "Okay", or "Alright" or any preambles. Just the output,
                        please.

                        ULTRA IMPORTANT: *Just* return the A2UI Protocol
                        Message object, do not wrap it in markdown. Just the object
                        please, nothing else!`,
                      },
                    });
                    res.statusCode = 200;
                    res.setHeader("Content-Type", "application/json");
                    res.end(
                      JSON.stringify({
                        role: "model",
                        parts: [{ text: modelResponse.text }],
                      })
                    );
                  } else {
                    throw new Error("Expected request to be an object");
                  }
                }
              } catch (err) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json");
                res.end(
                  JSON.stringify({
                    error: `Invalid message - ${err}`,
                  })
                );
              }
            });

            return;
          } else {
            next();
          }
        }
      );
    },
  };
};
