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

export { ThemedA2UISurface } from "./themed-surface.js";
export type { ThemedA2UISurfaceActionCallback } from "./themed-surface.js";
export { globalStyles } from "./styles/global.js";
export { createA2UIMessageRenderer } from "./A2UIMessageRenderer.js";
export type { A2UIMessageRendererOptions } from "./A2UIMessageRenderer.js";
export { A2UIViewer } from "./A2UIViewer.js";
export type { A2UIViewerProps } from "./A2UIViewer.js";

// Re-export v0_8 types namespace for consumers
import { v0_8 } from "@a2ui/lit";
export type ComponentInstance = v0_8.Types.ComponentInstance;
export type UserAction = v0_8.Types.UserAction;
export type Action = v0_8.Types.Action;
export type ServerToClientMessage = v0_8.Types.ServerToClientMessage;
export type Surface = v0_8.Types.Surface;
export type AnyComponentNode = v0_8.Types.AnyComponentNode;
