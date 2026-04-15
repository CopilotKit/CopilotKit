package com.copilotkit.showcase.springai.tools;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;

/**
 * Server-side weather tool that calls the Open-Meteo API.
 * Registered as "get_weather" in AgentConfig.
 */
public class WeatherTool implements Function<WeatherRequest, String> {

    private static final Map<Integer, String> CONDITIONS = new HashMap<>();
    static {
        CONDITIONS.put(0, "Clear sky");
        CONDITIONS.put(1, "Mainly clear");
        CONDITIONS.put(2, "Partly cloudy");
        CONDITIONS.put(3, "Overcast");
        CONDITIONS.put(51, "Light drizzle");
        CONDITIONS.put(61, "Slight rain");
        CONDITIONS.put(63, "Moderate rain");
        CONDITIONS.put(65, "Heavy rain");
        CONDITIONS.put(71, "Slight snow");
        CONDITIONS.put(80, "Rain showers");
        CONDITIONS.put(95, "Thunderstorm");
    }

    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String apply(WeatherRequest request) {
        WeatherResponse.GeocodingResponse geo;
        try {
            // Geocode the location
            String geoUrl = UriComponentsBuilder
                    .fromHttpUrl("https://geocoding-api.open-meteo.com/v1/search")
                    .queryParam("name", request.getLocation())
                    .queryParam("count", 1)
                    .toUriString();

            geo = restTemplate.getForObject(geoUrl, WeatherResponse.GeocodingResponse.class);
        } catch (RestClientException e) {
            return "Failed to geocode location '" + request.getLocation() + "': " + e.getMessage();
        }

        if (geo == null || geo.getResults() == null || geo.getResults().isEmpty()) {
            return "Location not found: " + request.getLocation();
        }

        WeatherResponse.GeocodingResult loc = geo.getResults().get(0);

        WeatherResponse weather;
        try {
            // Get weather
            String weatherUrl = UriComponentsBuilder
                    .fromHttpUrl("https://api.open-meteo.com/v1/forecast")
                    .queryParam("latitude", loc.getLatitude())
                    .queryParam("longitude", loc.getLongitude())
                    .queryParam("current", "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code")
                    .toUriString();

            weather = restTemplate.getForObject(weatherUrl, WeatherResponse.class);
        } catch (RestClientException e) {
            return "Failed to fetch weather for " + loc.getName() + ": " + e.getMessage();
        }

        if (weather == null || weather.getCurrent() == null) {
            return "Could not fetch weather for " + loc.getName();
        }

        WeatherResponse.CurrentWeather w = weather.getCurrent();
        String conditions = CONDITIONS.getOrDefault(w.getWeatherCode(), "Unknown");

        try {
            return new ObjectMapper().writeValueAsString(Map.of(
                    "city", loc.getName(),
                    "temperature", w.getTemperature2m(),
                    "humidity", (int) w.getRelativeHumidity2m(),
                    "wind_speed", w.getWindSpeed10m(),
                    "feels_like", w.getApparentTemperature(),
                    "conditions", conditions
            ));
        } catch (Exception e) {
            return "{\"error\": \"Failed to serialize weather data: " + e.getMessage() + "\"}";
        }
    }
}
