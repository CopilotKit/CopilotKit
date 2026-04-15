package com.copilotkit.showcase.springai.model;

public record SalesTodo(String id, String title, String stage, int value,
                        String dueDate, String assignee, boolean completed) {}
