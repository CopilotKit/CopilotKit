package com.copilotkit.showcase.springai.tools;

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
        // Geocode the location
        String geoUrl = UriComponentsBuilder
                .fromHttpUrl("https://geocoding-api.open-meteo.com/v1/search")
                .queryParam("name", request.getLocation())
                .queryParam("count", 1)
                .toUriString();

        WeatherResponse.GeocodingResponse geo = restTemplate.getForObject(geoUrl, WeatherResponse.GeocodingResponse.class);
        if (geo == null || geo.getResults() == null || geo.getResults().isEmpty()) {
            return "Location not found: " + request.getLocation();
        }

        WeatherResponse.GeocodingResult loc = geo.getResults().get(0);

        // Get weather
        String weatherUrl = UriComponentsBuilder
                .fromHttpUrl("https://api.open-meteo.com/v1/forecast")
                .queryParam("latitude", loc.getLatitude())
                .queryParam("longitude", loc.getLongitude())
                .queryParam("current", "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code")
                .toUriString();

        WeatherResponse weather = restTemplate.getForObject(weatherUrl, WeatherResponse.class);
        if (weather == null || weather.getCurrent() == null) {
            return "Could not fetch weather for " + loc.getName();
        }

        WeatherResponse.CurrentWeather w = weather.getCurrent();
        String condition = CONDITIONS.getOrDefault(w.getWeatherCode(), "Unknown");

        return String.format(
                "Weather in %s: %.1f°C (feels like %.1f°C), %s, humidity %d%%, wind %.1f km/h",
                loc.getName(), w.getTemperature2m(), w.getApparentTemperature(),
                condition, (int) w.getRelativeHumidity2m(), w.getWindSpeed10m()
        );
    }
}
