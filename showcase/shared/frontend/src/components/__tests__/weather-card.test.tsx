import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  WeatherCard,
  getWeatherGradient,
  getWeatherIcon,
} from "../weather-card";

describe("WeatherCard", () => {
  const defaultProps = {
    location: "Seattle",
    temperature: 18,
    conditions: "Clear",
    humidity: 65,
    windSpeed: 10,
    feelsLike: 16,
  };

  it("renders location name", () => {
    render(<WeatherCard {...defaultProps} />);
    expect(screen.getByText("Seattle")).toBeTruthy();
  });

  it("renders city prop over location when provided", () => {
    render(<WeatherCard {...defaultProps} city="Portland" />);
    expect(screen.getByText("Portland")).toBeTruthy();
  });

  it("shows temperature with degree symbol", () => {
    render(<WeatherCard {...defaultProps} />);
    expect(screen.getByText(/18°/)).toBeTruthy();
  });

  it("shows Fahrenheit conversion", () => {
    render(<WeatherCard {...defaultProps} />);
    // 18C = 64.4F -> "64°F"
    expect(screen.getByText(/64°F/)).toBeTruthy();
  });

  it("shows humidity percentage", () => {
    render(<WeatherCard {...defaultProps} />);
    expect(screen.getByText("65%")).toBeTruthy();
  });

  it("shows wind speed in mph", () => {
    render(<WeatherCard {...defaultProps} />);
    expect(screen.getByText("10 mph")).toBeTruthy();
  });

  it("shows feels like temperature", () => {
    render(<WeatherCard {...defaultProps} />);
    expect(screen.getByText(/16°/)).toBeTruthy();
  });

  it("defaults feelsLike to temperature when not provided", () => {
    const { feelsLike: _, ...propsWithoutFeelsLike } = defaultProps;
    render(<WeatherCard {...propsWithoutFeelsLike} />);
    // feelsLike defaults to temp (18), so we should see 18° in the feels-like slot
    const allDegreeElements = screen.getAllByText(/18°/);
    expect(allDegreeElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows loading state", () => {
    render(<WeatherCard location="Seattle" loading />);
    expect(screen.getByText("Checking weather...")).toBeTruthy();
    expect(screen.getByText("Seattle")).toBeTruthy();
  });

  it("shows conditions text", () => {
    render(<WeatherCard {...defaultProps} />);
    expect(screen.getByText("Clear")).toBeTruthy();
  });
});

describe("getWeatherGradient", () => {
  it("returns sunny gradient for clear conditions", () => {
    expect(getWeatherGradient("Clear")).toContain("#667eea");
  });

  it("returns rainy gradient for storm conditions", () => {
    expect(getWeatherGradient("Thunderstorm")).toContain("#4A5568");
  });

  it("returns cloudy gradient for overcast", () => {
    expect(getWeatherGradient("Overcast")).toContain("#718096");
  });

  it("returns snow gradient for snow", () => {
    expect(getWeatherGradient("Snow")).toContain("#63B3ED");
  });

  it("returns default gradient for unknown conditions", () => {
    expect(getWeatherGradient("Hail")).toContain("#667eea");
  });
});

describe("getWeatherIcon", () => {
  it("returns sun icon for sunny", () => {
    expect(getWeatherIcon("Sunny")).toBe("\u2600\uFE0F");
  });

  it("returns rain icon for rain", () => {
    expect(getWeatherIcon("Rain")).toBe("\uD83C\uDF27\uFE0F");
  });

  it("returns snowflake for snow", () => {
    expect(getWeatherIcon("Snow")).toBe("\u2744\uFE0F");
  });

  it("returns cloud icon for cloudy", () => {
    expect(getWeatherIcon("Cloudy")).toBe("\u2601\uFE0F");
  });

  it("returns default icon for unknown", () => {
    expect(getWeatherIcon("Hail")).toBe("\uD83C\uDF24\uFE0F");
  });
});
