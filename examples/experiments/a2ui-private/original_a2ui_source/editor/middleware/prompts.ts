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

export function createImageParsePrompt(
  catalog: v0_8.Types.ClientCapabilitiesDynamic,
  content: {
    inlineData: {
      mimeType: string;
      data: string;
    };
  }
) {
  if (!catalog) {
    throw new Error("No catalog specified");
  }

  const componentTypes = Object.keys(catalog.components);
  const prompt = {
    role: "user",
    parts: [
      `You are creating a text description for a User Interface. Ultimately this
      description will given to an agent which will use the A2UI Protocol to
      create the UI. I will provide the catalog of UI components to you so that
      you can reference it in your description. You will be provided an image by
      the user which you must describe in detail using plain English such that
      the UI agent will be able to recreate it with A2UI.

      Do not include any information about the specific contents, instead focus
      on the layout of the information. Describe what the broad types and where
      information sits relative to other items, e.g, row of cards. In each card
      there is an image at the top, and a title and description below.

    Here's everything you need:`,

      `The user's layout image is: `,
      content,
      `The Component Catalog you can refer to is: ${componentTypes.join(", ")}`,
    ].map((item) => {
      if (typeof item === "object") {
        return item;
      }

      return { text: item };
    }),
  };

  return prompt;
}

export function createA2UIPrompt(
  catalog: v0_8.Types.ClientCapabilitiesDynamic,
  imageDescription: string,
  instructions: string
) {
  if (!catalog) {
    throw new Error("No catalog specified");
  }

  const combinedInstructions: string[] = [];
  if (imageDescription !== "") {
    combinedInstructions.push(imageDescription);
  }
  if (instructions !== "") {
    combinedInstructions.push(instructions);
  }

  if (combinedInstructions.length === 0) {
    throw new Error("No instructions provided");
  }

  const prompt = {
    role: "user",
    parts: [
      `You are creating a layout for a User Interface. It will be using a
    format called A2UI which has several distinct schemas, each of which I will
    provide to you. The user will be providing information about the UI they
    would like to generate and your job is to create the JSON payloads as a
    single array. Alternatively the user may provide a reference image and you
    must try to understand it and match it as closely as possible.,

    Here's everything you need:`,

      `The user's layout request is: "${combinedInstructions.join('" and "')}"`,
      `The Component Catalog you can use is: ${JSON.stringify(catalog)}`,
      `The A2UI Protocol Message Schema: "${JSON.stringify(
        v0_8.Schemas.A2UIClientEventMessage
      )}"`,

      `Please return a valid A2UI Protocol Message object necessary to build the
      user interface from scratch. If you choose to return multiple object you
      must wrap them in an array and ensure there is a beginRendering message.`,

      `If no data is provided create some. If there are any URLs you must
    make them absolute and begin with a /. Nothing should ever be loaded from
    a remote source`,
    ].map((text) => {
      return { text };
    }),
  };

  return prompt;
}
