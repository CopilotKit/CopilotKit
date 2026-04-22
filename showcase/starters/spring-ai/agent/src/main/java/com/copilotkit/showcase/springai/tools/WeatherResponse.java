package com.copilotkit.showcase.springai.tools;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public class WeatherResponse {
    private CurrentWeather current;

    public CurrentWeather getCurrent() { return current; }
    public void setCurrent(CurrentWeather current) { this.current = current; }

    public static class CurrentWeather {
        @JsonProperty("temperature_2m")
        private double temperature2m;
        @JsonProperty("apparent_temperature")
        private double apparentTemperature;
        @JsonProperty("relative_humidity_2m")
        private double relativeHumidity2m;
        @JsonProperty("wind_speed_10m")
        private double windSpeed10m;
        @JsonProperty("weather_code")
        private int weatherCode;

        public double getTemperature2m() { return temperature2m; }
        public void setTemperature2m(double v) { this.temperature2m = v; }
        public double getApparentTemperature() { return apparentTemperature; }
        public void setApparentTemperature(double v) { this.apparentTemperature = v; }
        public double getRelativeHumidity2m() { return relativeHumidity2m; }
        public void setRelativeHumidity2m(double v) { this.relativeHumidity2m = v; }
        public double getWindSpeed10m() { return windSpeed10m; }
        public void setWindSpeed10m(double v) { this.windSpeed10m = v; }
        public int getWeatherCode() { return weatherCode; }
        public void setWeatherCode(int v) { this.weatherCode = v; }
    }

    /** Geocoding API response */
    public static class GeocodingResponse {
        private List<GeocodingResult> results;
        public List<GeocodingResult> getResults() { return results; }
        public void setResults(List<GeocodingResult> r) { this.results = r; }
    }

    public static class GeocodingResult {
        private double latitude;
        private double longitude;
        private String name;
        public double getLatitude() { return latitude; }
        public void setLatitude(double v) { this.latitude = v; }
        public double getLongitude() { return longitude; }
        public void setLongitude(double v) { this.longitude = v; }
        public String getName() { return name; }
        public void setName(String v) { this.name = v; }
    }
}
