"""Shared type definitions for showcase tools."""

from typing import TypedDict, Literal

SalesStage = Literal[
    "prospect",
    "qualified",
    "proposal",
    "negotiation",
    "closed-won",
    "closed-lost",
]

class SalesTodo(TypedDict):
    id: str
    title: str
    stage: SalesStage
    value: int
    dueDate: str
    assignee: str
    completed: bool

class Flight(TypedDict):
    airline: str
    airlineLogo: str
    flightNumber: str
    origin: str
    destination: str
    date: str
    departureTime: str
    arrivalTime: str
    duration: str
    status: str
    statusColor: str
    price: str
    currency: str

class WeatherResult(TypedDict):
    city: str
    temperature: int
    humidity: int
    wind_speed: int
    feels_like: int
    conditions: str
