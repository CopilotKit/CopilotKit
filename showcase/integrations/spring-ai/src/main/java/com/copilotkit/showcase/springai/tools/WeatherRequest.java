package com.copilotkit.showcase.springai.tools;

public class WeatherRequest {
    private String location;

    public WeatherRequest() {}

    public WeatherRequest(String location) {
        this.location = location;
    }

    public String getLocation() { return location; }
    public void setLocation(String location) { this.location = location; }
}
