package com.copilotkit.showcase.springai.tools;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Returns flight search results with A2UI rendering data.
 * Registered as "search_flights" in AgentConfig.
 */
public class SearchFlightsTool implements Function<SearchFlightsTool.Request, String> {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public record Request(String origin, String destination) {}

    private static final String CATALOG_ID = "copilotkit://app-dashboard-catalog";
    private static final String SURFACE_ID = "flight-search-results";

    private static final List<Map<String, Object>> FLIGHT_SCHEMA = List.of(
        Map.of(
            "id", "root",
            "component", "Row",
            "children", Map.of("componentId", "flight-card", "path", "/flights"),
            "gap", 16
        ),
        Map.ofEntries(
            Map.entry("id", "flight-card"),
            Map.entry("component", "FlightCard"),
            Map.entry("airline", Map.of("path", "airline")),
            Map.entry("airlineLogo", Map.of("path", "airlineLogo")),
            Map.entry("flightNumber", Map.of("path", "flightNumber")),
            Map.entry("origin", Map.of("path", "origin")),
            Map.entry("destination", Map.of("path", "destination")),
            Map.entry("date", Map.of("path", "date")),
            Map.entry("departureTime", Map.of("path", "departureTime")),
            Map.entry("arrivalTime", Map.of("path", "arrivalTime")),
            Map.entry("duration", Map.of("path", "duration")),
            Map.entry("status", Map.of("path", "status")),
            Map.entry("price", Map.of("path", "price")),
            Map.entry("action", Map.of(
                "event", Map.of(
                    "name", "book_flight",
                    "context", Map.of(
                        "flightNumber", Map.of("path", "flightNumber"),
                        "origin", Map.of("path", "origin"),
                        "destination", Map.of("path", "destination"),
                        "price", Map.of("path", "price")
                    )
                )
            ))
        )
    );

    private static final List<Map<String, String>> SAMPLE_FLIGHTS = List.of(
        Map.ofEntries(
            Map.entry("airline", "United Airlines"),
            Map.entry("airlineLogo", "UA"),
            Map.entry("flightNumber", "UA 2451"),
            Map.entry("origin", "SFO"),
            Map.entry("destination", "JFK"),
            Map.entry("date", "2026-05-15"),
            Map.entry("departureTime", "08:00"),
            Map.entry("arrivalTime", "16:35"),
            Map.entry("duration", "5h 35m"),
            Map.entry("status", "On Time"),
            Map.entry("statusColor", "green"),
            Map.entry("price", "$342"),
            Map.entry("currency", "USD")
        ),
        Map.ofEntries(
            Map.entry("airline", "Delta Air Lines"),
            Map.entry("airlineLogo", "DL"),
            Map.entry("flightNumber", "DL 1087"),
            Map.entry("origin", "SFO"),
            Map.entry("destination", "JFK"),
            Map.entry("date", "2026-05-15"),
            Map.entry("departureTime", "10:30"),
            Map.entry("arrivalTime", "19:15"),
            Map.entry("duration", "5h 45m"),
            Map.entry("status", "On Time"),
            Map.entry("statusColor", "green"),
            Map.entry("price", "$289"),
            Map.entry("currency", "USD")
        ),
        Map.ofEntries(
            Map.entry("airline", "JetBlue Airways"),
            Map.entry("airlineLogo", "B6"),
            Map.entry("flightNumber", "B6 524"),
            Map.entry("origin", "SFO"),
            Map.entry("destination", "JFK"),
            Map.entry("date", "2026-05-15"),
            Map.entry("departureTime", "14:15"),
            Map.entry("arrivalTime", "22:50"),
            Map.entry("duration", "5h 35m"),
            Map.entry("status", "On Time"),
            Map.entry("statusColor", "green"),
            Map.entry("price", "$315"),
            Map.entry("currency", "USD")
        )
    );

    @Override
    public String apply(Request request) {
        try {
            var operations = List.of(
                Map.of("type", "create_surface", "surfaceId", SURFACE_ID, "catalogId", CATALOG_ID),
                Map.of("type", "update_components", "surfaceId", SURFACE_ID, "components", FLIGHT_SCHEMA),
                Map.of("type", "update_data_model", "surfaceId", SURFACE_ID, "data", Map.of("flights", SAMPLE_FLIGHTS))
            );
            return MAPPER.writeValueAsString(Map.of("a2ui_operations", operations));
        } catch (Exception e) {
            return "{\"error\":\"serialization failed\"}";
        }
    }
}
