import { describe, it, expect } from "vitest";
import { getWeatherImpl } from "../get-weather";

describe("getWeatherImpl", () => {
  it("returns all required fields", () => {
    const result = getWeatherImpl("Tokyo");
    expect(result).toHaveProperty("city");
    expect(result).toHaveProperty("temperature");
    expect(result).toHaveProperty("humidity");
    expect(result).toHaveProperty("wind_speed");
    expect(result).toHaveProperty("feels_like");
    expect(result).toHaveProperty("conditions");
  });

  it("passes city name through", () => {
    expect(getWeatherImpl("San Francisco").city).toBe("San Francisco");
  });

  it("is deterministic for the same city", () => {
    const r1 = getWeatherImpl("Tokyo");
    const r2 = getWeatherImpl("Tokyo");
    expect(r1.temperature).toBe(r2.temperature);
    expect(r1.conditions).toBe(r2.conditions);
  });

  it("produces different results for different cities", () => {
    const r1 = getWeatherImpl("Tokyo");
    const r2 = getWeatherImpl("London");
    expect(r1).not.toEqual(r2);
  });

  it("temperature is within expected range (20-95)", () => {
    const result = getWeatherImpl("Berlin");
    expect(result.temperature).toBeGreaterThanOrEqual(20);
    expect(result.temperature).toBeLessThanOrEqual(95);
  });

  it("humidity is within expected range (30-90)", () => {
    const result = getWeatherImpl("Paris");
    expect(result.humidity).toBeGreaterThanOrEqual(30);
    expect(result.humidity).toBeLessThanOrEqual(90);
  });

  it("wind_speed is within expected range (2-30)", () => {
    const result = getWeatherImpl("Sydney");
    expect(result.wind_speed).toBeGreaterThanOrEqual(2);
    expect(result.wind_speed).toBeLessThanOrEqual(30);
  });

  it("conditions is one of the known values", () => {
    const known = [
      "Sunny",
      "Partly Cloudy",
      "Cloudy",
      "Overcast",
      "Light Rain",
      "Heavy Rain",
      "Thunderstorm",
      "Snow",
      "Foggy",
      "Windy",
    ];
    const result = getWeatherImpl("Miami");
    expect(known).toContain(result.conditions);
  });

  it("is case-insensitive for seed (lowercased internally)", () => {
    const r1 = getWeatherImpl("tokyo");
    const r2 = getWeatherImpl("TOKYO");
    expect(r1.temperature).toBe(r2.temperature);
  });

  it("feels_like is within ±5 of temperature", () => {
    const result = getWeatherImpl("Berlin");
    expect(
      Math.abs(result.feels_like - result.temperature),
    ).toBeLessThanOrEqual(5);
  });
});
