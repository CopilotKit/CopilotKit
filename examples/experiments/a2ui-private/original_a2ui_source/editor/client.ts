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

import { v0_8 } from "@a2ui/web-lib";

const catalog: v0_8.Types.ClientCapabilitiesDynamic = {
  components:
    v0_8.Schemas.A2UIClientEventMessage["properties"]["surfaceUpdate"][
      "properties"
    ]["components"]["items"]["properties"]["component"]["properties"],
  styles: {},
};

export class A2UIClient {
  #ready: Promise<void> = Promise.resolve();
  constructor() {
    this.#handshake();
  }

  #handshake() {
    this.#ready = new Promise((resolve, reject) => {
      try {
        (async () => {
          await this.#send({
            clientUiCapabilities: {
              dynamicCatalog: catalog,
            },
          });
          console.log("A2UI Client Handshake");
          resolve();
        })();
      } catch (err) {
        reject(err);
      }
    });
  }

  get ready() {
    return this.#ready;
  }

  async sendMultipart(imageData?: string, instructions?: string) {
    if (
      typeof instructions === "undefined" &&
      typeof imageData === "undefined"
    ) {
      throw new Error("No data provided");
    }

    return this.#send({
      request: {
        imageData,
        instructions,
      },
    });
  }

  async #send<T extends { role: "model"; parts: Array<{ text: string }> }>(
    message: v0_8.Types.A2UIClientEventMessage
  ) {
    const response = await fetch("/a2ui", {
      body: JSON.stringify(message),
      method: "POST",
    });
    if (response.ok) return response.json() as unknown as T;
    const error = (await response.json()) as { error: string };
    throw new Error(error.error);
  }
}
