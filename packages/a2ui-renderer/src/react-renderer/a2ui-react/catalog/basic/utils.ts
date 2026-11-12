/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type React from "react";

/**
 * Map the binder's resolved common accessibility values onto an existing host.
 * Undefined values deliberately remove attributes left by an earlier snapshot.
 */
export function getAccessibilityProps(accessibility?: {
  label?: string;
  description?: string;
  live?: React.AriaAttributes["aria-live"];
  hidden?: boolean;
}): React.AriaAttributes {
  return {
    "aria-label": accessibility?.label || undefined,
    "aria-description": accessibility?.description || undefined,
    "aria-live": accessibility?.live || undefined,
    "aria-hidden":
      typeof accessibility?.hidden === "boolean"
        ? accessibility.hidden
        : undefined,
  };
}

// The rules live in the framework-neutral basic-styles module, shared with
// the Vue and Angular renderers.
export {
  LEAF_MARGIN,
  CONTAINER_PADDING,
  STANDARD_BORDER,
  STANDARD_RADIUS,
  mapJustify,
  mapAlign,
  getBaseLeafStyle,
  getBaseContainerStyle,
  getDateTimeInputType,
} from "../../../../basic-styles";
