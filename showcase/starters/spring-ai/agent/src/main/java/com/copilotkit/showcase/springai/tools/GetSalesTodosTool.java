package com.copilotkit.showcase.springai.tools;

import com.copilotkit.showcase.springai.model.SalesTodo;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/**
 * Returns the current sales pipeline todos.
 * Registered as "get_sales_todos" in AgentConfig.
 */
public class GetSalesTodosTool implements Function<GetSalesTodosTool.Request, String> {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public record Request() {}

    private static final List<SalesTodo> INITIAL_TODOS = List.of(
        new SalesTodo("st-001", "Follow up with Acme Corp on enterprise proposal", "proposal", 85000, "2026-04-15", "Sarah Chen", false),
        new SalesTodo("st-002", "Qualify lead from TechFlow demo request", "prospect", 42000, "2026-04-18", "Mike Johnson", false),
        new SalesTodo("st-003", "Send contract to DataViz Inc for final review", "negotiation", 120000, "2026-04-20", "Sarah Chen", false)
    );

    private final List<SalesTodo> todos;

    public GetSalesTodosTool(List<SalesTodo> todos) {
        this.todos = todos;
    }

    public GetSalesTodosTool() {
        this(new ArrayList<>(INITIAL_TODOS));
    }

    @Override
    public String apply(Request request) {
        try {
            return MAPPER.writeValueAsString(todos);
        } catch (Exception e) {
            return "[]";
        }
    }

    public List<SalesTodo> getTodos() {
        return todos;
    }
}
