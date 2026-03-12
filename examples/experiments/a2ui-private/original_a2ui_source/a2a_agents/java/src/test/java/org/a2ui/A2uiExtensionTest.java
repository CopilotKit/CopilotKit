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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.a2a.spec.DataPart;
import io.a2a.spec.Part;
import io.a2a.spec.TextPart;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

public class A2uiExtensionTest {

  @Test
  void testA2uiPartSerialization() {
    // 1. Create a sample A2UI data map
    Map<String, Object> beginRendering = new HashMap<>();
    beginRendering.put("surfaceId", "test-surface");
    beginRendering.put("root", "root-column");
    Map<String, Object> a2uiData = new HashMap<>();
    a2uiData.put("beginRendering", beginRendering);

    // 2. Serialize to Part
    DataPart part = A2uiExtension.createA2uiDataPart(a2uiData);

    // 3. Verify it is an A2UI part
    assertTrue(A2uiExtension.isA2uiPart(part), "Should be identified as A2UI part");

    // 4. Deserialize back to Map
    Optional<DataPart> dataPart = A2uiExtension.getA2uiDataPart(part);
    assertTrue(dataPart.isPresent(), "Should contain DataPart");

    Map<String, Object> deserializedData = dataPart.get().getData();

    // 5. Verify equality
    assertEquals(a2uiData, deserializedData, "Deserialized data should match original");
  }

  @Test
  void testNonA2uiDataPart() {
    // Create a generic DataPart without A2UI mime type
    Map<String, Object> data = new HashMap<>();
    data.put("foo", "bar");
    Map<String, Object> metadata = new HashMap<>();
    metadata.put("mimeType", "application/json"); // Not A2UI
    DataPart dataPart = new DataPart(data, metadata);    

    assertFalse(A2uiExtension.isA2uiPart(dataPart), "Should not be identified as A2UI part");
    assertTrue(A2uiExtension.getA2uiDataPart(dataPart).isEmpty(), "Should not return A2UI DataPart");
  }

  @Test
  void testNonA2uiPart() {
    TextPart textPart = new TextPart("this is some text");    

    assertFalse(A2uiExtension.isA2uiPart(textPart), "Should not be identified as A2UI part");
    assertTrue(A2uiExtension.getA2uiDataPart(textPart).isEmpty(), "Should not return A2UI DataPart");
  }
}
