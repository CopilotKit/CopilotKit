package com.copilotkit.showcase.springai.tools;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * A2UI Fixed Schema display tool.
 *
 * Emits a fixed "Flight Card" component tree plus a data model populated
 * with the provided origin/destination/airline/price. The frontend catalog
 * at src/app/demos/a2ui-fixed-schema/a2ui/ pins each component name to a
 * React renderer.
 *
 * Registered as "display_flight" on the dedicated a2ui-fixed-schema agent
 * bean (see AgentConfigFixedSchema).
 */
public class DisplayFlightTool implements Function<DisplayFlightTool.Request, String> {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String CATALOG_ID = "copilotkit://flight-fixed-catalog";
    private static final String SURFACE_ID = "flight-fixed-schema";

    public record Request(String origin, String destination, String airline, String price) {}

    private static final List<Map<String, Object>> FLIGHT_SCHEMA = List.of(
            Map.of("id", "root", "component", "Card", "child", "content"),
            Map.of("id", "content", "component", "Column",
                    "children", List.of("title", "route", "meta", "bookButton")),
            Map.of("id", "title", "component", "Title", "text", "Flight Details"),
            Map.of("id", "route", "component", "Row", "justify", "spaceBetween",
                    "align", "center", "children", List.of("from", "arrow", "to")),
            Map.of("id", "from", "component", "Airport",
                    "code", Map.of("path", "/origin")),
            Map.of("id", "arrow", "component", "Arrow"),
            Map.of("id", "to", "component", "Airport",
                    "code", Map.of("path", "/destination")),
            Map.of("id", "meta", "component", "Row", "justify", "spaceBetween",
                    "align", "center", "children", List.of("airline", "price")),
            Map.of("id", "airline", "component", "AirlineBadge",
                    "name", Map.of("path", "/airline")),
            Map.of("id", "price", "component", "PriceTag",
                    "amount", Map.of("path", "/price")),
            Map.of("id", "bookButton", "component", "Button",
                    "variant", "primary", "child", "bookButtonLabel",
                    "action", Map.of(
                            "event", Map.of(
                                    "name", "book_flight",
                                    "context", Map.of(
                                            "origin", Map.of("path", "/origin"),
                                            "destination", Map.of("path", "/destination"),
                                            "airline", Map.of("path", "/airline"),
                                            "price", Map.of("path", "/price")
                                    )
                            )
                    )),
            Map.of("id", "bookButtonLabel", "component", "Text", "text", "Book flight")
    );

    @Override
    public String apply(Request request) {
        try {
            // @region[backend-render-operations]
            // The A2UI middleware detects the `a2ui_operations` container in
            // this tool result and forwards the ops to the frontend renderer.
            // The frontend catalog resolves component names to the local
            // React components.
            var ops = List.of(
                    Map.of("type", "create_surface",
                            "surfaceId", SURFACE_ID,
                            "catalogId", CATALOG_ID),
                    Map.of("type", "update_components",
                            "surfaceId", SURFACE_ID,
                            "components", FLIGHT_SCHEMA),
                    Map.of("type", "update_data_model",
                            "surfaceId", SURFACE_ID,
                            "data", Map.of(
                                    "origin", request.origin(),
                                    "destination", request.destination(),
                                    "airline", request.airline(),
                                    "price", request.price()
                            ))
            );
            return MAPPER.writeValueAsString(Map.of("a2ui_operations", ops));
            // @endregion[backend-render-operations]
        } catch (Exception e) {
            return "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}";
        }
    }
}
