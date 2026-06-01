package com.copilotkit.showcase.springai.tools;

import com.copilotkit.showcase.springai.model.SalesTodo;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.UUID;
import java.util.function.Function;

/**
 * Updates the sales pipeline with a new set of todos.
 * Registered as "manage_sales_todos" in AgentConfig.
 */
public class ManageSalesTodosTool implements Function<ManageSalesTodosTool.Request, String> {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    public record Request(List<TodoInput> todos) {}

    public record TodoInput(String id, String title, String stage, int value,
                            String dueDate, String assignee, boolean completed) {}

    private final List<SalesTodo> sharedTodos;

    public ManageSalesTodosTool(List<SalesTodo> sharedTodos) {
        this.sharedTodos = sharedTodos;
    }

    @Override
    public String apply(Request request) {
        sharedTodos.clear();
        for (var input : request.todos()) {
            String id = (input.id() == null || input.id().isEmpty())
                ? UUID.randomUUID().toString().substring(0, 8)
                : input.id();
            sharedTodos.add(new SalesTodo(
                id,
                input.title(),
                input.stage(),
                input.value(),
                input.dueDate(),
                input.assignee(),
                input.completed()
            ));
        }
        try {
            return MAPPER.writeValueAsString(sharedTodos);
        } catch (Exception e) {
            return "{\"status\":\"error\"}";
        }
    }
}
