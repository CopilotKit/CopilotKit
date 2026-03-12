/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.a2ui;

import io.a2a.server.agentexecution.RequestContext;
import io.a2a.spec.AgentExtension;
import io.a2a.spec.DataPart;
import io.a2a.spec.Part;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.logging.Logger;

/**
 * Utilities for the A2UI A2A Extension.
 */
public final class A2uiExtension {
  private static final Logger logger = Logger.getLogger(A2uiExtension.class.getName());

  public static final String A2UI_EXTENSION_URI = "https://a2ui.org/a2a-extension/a2ui/v0.8";
  public static final String MIME_TYPE_KEY = "mimeType";
  public static final String A2UI_MIME_TYPE = "application/json+a2ui";

  private A2uiExtension() {
    // Prevent instantiation
  }

  /**
   * Creates an A2A Part containing A2UI data.
   *
   * @param a2uiData The A2UI data map.
   * @return An A2A Part with a DataPart containing the A2UI data.
   */
  public static DataPart createA2uiDataPart(Map<String, Object> a2uiData) {
    Map<String, Object> metadata = new HashMap<>();
    metadata.put(MIME_TYPE_KEY, A2UI_MIME_TYPE);
    
    return new DataPart(a2uiData, metadata);
  }

  /**
   * Checks if an A2A Part contains A2UI data.
   *
   * @param part The A2A Part to check.
   * @return True if the part contains A2UI data, False otherwise.
   */
  public static boolean isA2uiPart(Part part) {
    if (part instanceof DataPart) {
      DataPart dataPart = (DataPart) part;
      Map<String, Object> metadata = dataPart.getMetadata();
      return metadata != null && A2UI_MIME_TYPE.equals(metadata.get(MIME_TYPE_KEY));
    }
    return false;
  }

  /**
   * Extracts the DataPart containing A2UI data from an A2A Part, if present.
   *
   * @param part The A2A Part to extract A2UI data from.
   * @return The DataPart containing A2UI data if present, empty otherwise.
   */
  public static Optional<DataPart> getA2uiDataPart(Part part) {
    if (isA2uiPart(part)) {
      return Optional.of((DataPart) part);
    }
    return Optional.empty();
  }
}
