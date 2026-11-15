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

import React from "react";
import { createReactComponent } from "../../../adapter";
import { SliderApi } from "@a2ui/web_core/v0_9/basic_catalog";
import { getAccessibilityProps, LEAF_MARGIN } from "../utils";

export const Slider = createReactComponent(
  SliderApi,
  /** Put accessibility on the range control while retaining protocol-specific step behavior. */
  ({ props, context }) => {
    const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      props.setValue(Number(e.target.value));
    };

    const uniqueId = React.useId();
    const min = props.min ?? 0;
    const max = props.max ?? 100;
    const steps = "steps" in props ? props.steps : undefined;
    // The 1.0 property counts divisions; the HTML property is their size.
    const step =
      typeof steps === "number" && steps > 0 && max > min
        ? (max - min) / steps
        : context.componentModel.catalog?.protocolVersion === "1.0"
          ? "any"
          : undefined;

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          margin: LEAF_MARGIN,
          width: "100%",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {props.label && (
            <label
              htmlFor={uniqueId}
              style={{ fontSize: "14px", fontWeight: "bold" }}
            >
              {props.label}
            </label>
          )}
          <span
            style={{ fontSize: "12px", color: "var(--a2ui-color-muted, #666)" }}
          >
            {props.value}
          </span>
        </div>
        <input
          {...getAccessibilityProps(props.accessibility)}
          id={uniqueId}
          type="range"
          min={min}
          max={props.max}
          step={step}
          value={props.value ?? 0}
          onChange={onChange}
          style={{ width: "100%", cursor: "pointer" }}
        />
      </div>
    );
  },
);
