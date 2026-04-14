import pytest
from tools import get_weather_impl

def test_returns_all_required_fields():
    result = get_weather_impl("Tokyo")
    assert "city" in result
    assert "temperature" in result
    assert "humidity" in result
    assert "wind_speed" in result
    assert "feels_like" in result
    assert "conditions" in result

def test_city_name_passed_through():
    result = get_weather_impl("San Francisco")
    assert result["city"] == "San Francisco"

def test_deterministic_for_same_city():
    r1 = get_weather_impl("Tokyo")
    r2 = get_weather_impl("Tokyo")
    assert r1["temperature"] == r2["temperature"]
    assert r1["conditions"] == r2["conditions"]

def test_different_cities_produce_different_results():
    r1 = get_weather_impl("Tokyo")
    r2 = get_weather_impl("London")
    # At least one field should differ (statistically guaranteed with seeded RNG)
    assert r1 != r2

def test_temperature_in_valid_range():
    result = get_weather_impl("TestCity")
    assert 20 <= result["temperature"] <= 95

def test_humidity_in_valid_range():
    result = get_weather_impl("TestCity")
    assert 30 <= result["humidity"] <= 90

def test_case_insensitivity():
    r_lower = get_weather_impl("tokyo")
    r_upper = get_weather_impl("TOKYO")
    r_mixed = get_weather_impl("Tokyo")
    assert r_lower["temperature"] == r_upper["temperature"] == r_mixed["temperature"]
    assert r_lower["conditions"] == r_upper["conditions"] == r_mixed["conditions"]

def test_feels_like_within_five_of_temperature():
    result = get_weather_impl("TestCity")
    assert abs(result["feels_like"] - result["temperature"]) <= 5

def test_wind_speed_in_valid_range():
    result = get_weather_impl("TestCity")
    assert 2 <= result["wind_speed"] <= 30
