package com.copilotkit.showcase.springai.tools;

import com.agui.core.context.Context;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.*;

class GenerateA2uiContextTest {
    @Test
    void preservesSchemaAndFactsWhileAdaptingOnlyTransportGuidance() {
        String schema = "{\"catalogId\":\"sales\",\"components\":{\"Card\":{\"description\":\"render_a2ui literal\"}}}";
        String facts = "Sales note: render_a2ui is a literal customer value.";
        var context = GenerateA2uiTool.uiContext(List.of(
                new Context("A2UI Component Schema", schema),
                new Context("A2UI generation guidelines", "CRITICAL: You MUST call the render_a2ui tool.\nCOMPONENT ID RULES:\nExactly one root."),
                new Context("Sales dataset for Vantage Threads (the demo company)", facts),
                new Context("Unrelated context", "Do not copy this")));
        assertEquals("sales", context.catalogId());
        assertTrue(context.instructions().contains(schema));
        assertTrue(context.instructions().contains(facts));
        assertTrue(context.instructions().contains("COMPONENT ID RULES:\nExactly one root."));
        assertFalse(context.instructions().contains("MUST call the render_a2ui"));
        assertFalse(context.instructions().contains("Do not copy this"));
    }

    @Test
    void noSchemaRetainsLegacyPathAndMalformedSchemaFailsExplicitly() {
        assertNull(GenerateA2uiTool.uiContext(null));
        assertNull(GenerateA2uiTool.uiContext(List.of(new Context("Sales context", "facts"))));
        assertThrows(IllegalArgumentException.class, () -> GenerateA2uiTool.uiContext(
                List.of(new Context("A2UI Component Schema", "invalid json"))));
        assertThrows(IllegalArgumentException.class, () -> GenerateA2uiTool.uiContext(List.of(
                new Context("A2UI Component Schema", "{\"catalogId\":\"sales\"}"),
                new Context("A2UI generation guidelines", "unrecognized transport contract"))));
    }

    @Test
    void concurrentCatalogsAndLaterInputMutationDoNotLeakAcrossRuns() {
        var results = IntStream.range(0, 100).parallel().mapToObj(index -> {
            String catalog = index % 2 == 0 ? "declarative-gen-ui-catalog" : "copilotkit://app-dashboard-catalog";
            var input = new ArrayList<>(List.of(new Context("A2UI Component Schema",
                    "{\"catalogId\":\"" + catalog + "\"}")));
            var result = GenerateA2uiTool.uiContext(input);
            input.clear();
            assertEquals(catalog, result.catalogId());
            assertTrue(result.instructions().contains(catalog));
            return result;
        }).toList();
        assertEquals(100, results.size());
    }
    @Test
    void serializesTheInstalledV09EnvelopeWithoutChangingComponentsOrData() throws Exception {
        var mapper = new ObjectMapper();
        var args = mapper.readTree("""
                {"surfaceId":"sales-dashboard","catalogId":"model-must-not-override",
                 "components":[{"id":"root","component":"Metric","label":"Revenue","value":"$4.2M"}],
                 "data":{"amount":4200000,"nested":{"name":"Vantage Threads"}}}
                """);
        var result = mapper.readTree(GenerateA2uiTool.serializeOperations(args,
                new GenerateA2uiTool.UiContext("declarative-gen-ui-catalog", "")));
        var ops = result.path("a2ui_operations");
        assertEquals(3, ops.size());
        assertEquals("v0.9", ops.get(0).path("version").asText());
        assertEquals("sales-dashboard", ops.get(0).path("createSurface").path("surfaceId").asText());
        assertEquals("declarative-gen-ui-catalog", ops.get(0).path("createSurface").path("catalogId").asText());
        assertEquals("v0.9", ops.get(1).path("version").asText());
        assertEquals(args.path("components"), ops.get(1).path("updateComponents").path("components"));
        assertEquals("sales-dashboard", ops.get(1).path("updateComponents").path("surfaceId").asText());
        assertEquals("v0.9", ops.get(2).path("version").asText());
        assertEquals("/", ops.get(2).path("updateDataModel").path("path").asText());
        assertEquals(args.path("data"), ops.get(2).path("updateDataModel").path("value"));
        assertFalse(ops.get(0).has("type"));
    }

    @Test
    void omitsAbsentDataAndRetainsLegacyCatalogFallback() throws Exception {
        var mapper = new ObjectMapper();
        var args = mapper.readTree("{\"components\":[],\"data\":null}");
        var ops = mapper.readTree(GenerateA2uiTool.serializeOperations(args, null)).path("a2ui_operations");
        assertEquals(2, ops.size());
        assertEquals("dynamic-surface", ops.get(0).path("createSurface").path("surfaceId").asText());
        assertEquals("copilotkit://app-dashboard-catalog", ops.get(0).path("createSurface").path("catalogId").asText());
    }

}
