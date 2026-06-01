package com.copilotkit.showcase.springai.tools;

import java.util.*;
import java.util.function.Function;

public class QueryDataTool implements Function<QueryDataTool.Request, String> {
    public record Request(String query) {}

    @Override
    public String apply(Request request) {
        var categories = List.of("Engineering", "Marketing", "Sales", "Support", "Design");
        var random = new Random();
        var sb = new StringBuilder("[");
        for (int i = 0; i < categories.size(); i++) {
            if (i > 0) sb.append(",");
            sb.append(String.format("{\"category\":\"%s\",\"value\":%d,\"quarter\":\"Q1 2026\"}",
                categories.get(i), random.nextInt(90000) + 10000));
        }
        sb.append("]");
        return sb.toString();
    }
}
