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

import { config } from "dotenv";
import { UserConfig } from "vite";
import * as Middleware from "./middleware";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default async () => {
  config();

  const entry: Record<string, string> = {
    editor: resolve(__dirname, "index.html"),
  };

  return {
    plugins: [
      Middleware.GeminiMiddleware.plugin(),
      Middleware.ImageFallbackMiddleware.plugin(
        "public/sample/forest_path.jpg"
      ),
    ],
    build: {
      rollupOptions: {
        input: entry,
      },
      target: "esnext",
    },
    define: {},
    resolve: {
      dedupe: ["lit"],
    },
  } satisfies UserConfig;
};
