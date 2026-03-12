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

import { Artifact, Part } from '@a2a-js/sdk';
import { UiMessageContent } from '@a2a_chat_canvas/types/ui-message';
import { InputSignal, Type } from '@angular/core';

/**
 * Contextual information for rendering UI components.
 */
export interface RenderingContext {
  /** True if there is an active A2A message stream. */
  readonly isA2aStreamOpen: boolean;
}

/** Interface for a component that resolves content variants. */
export interface RendererComponent {
  /** The content of the UI message. */
  readonly uiMessageContent: InputSignal<UiMessageContent>;
}

/**
 * Type for a function that dynamically loads a RendererComponent class.
 * Used for lazy loading components in the A2aRenderer.
 */
export type RendererComponentClassLoader = () => Promise<Type<RendererComponent>>;

/**
 * Represents an entry in the renderer map.
 * It's a tuple containing the variant name string and the corresponding component class loader function.
 */
export type RendererEntry = [
  variantName: string,
  componentClassLoader: RendererComponentClassLoader,
];

/**
 * Type definition for a function that attempts to resolve a content variant
 * string for a given ReadonlyPart.
 *
 * Returns null if no variant can be resolved.
 */
export type PartResolver = (part: Part) => string | null;

/**
 * Unresolved variant for a2a.v1.Part.
 */
export const UNRESOLVED_PART_VARIANT = 'unresolved_part';

/**
 * Type definition for a function that attempts to resolve a content variant
 * string for a given ReadonlyArtifact.
 *
 * Returns null if no variant can be resolved.
 */
export type ArtifactResolver = (part: Artifact) => string | null;

/**
 * Unresolved variant for a2a.v1.Artifact.
 */
export const UNRESOLVED_ARTIFACT_VARIANT = 'unresolved_artifact';
