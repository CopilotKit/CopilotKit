/**
 * TripRequirementsForm Component
 *
 * HITL form that collects trip details (city, days, people, budget level)
 * at the start of the workflow. Supports pre-filling from user messages
 * and validates input before submission.
 */

import React, { useState, useEffect } from "react";

interface TripRequirementsFormProps {
  args: any;
  respond: any;
}

export const TripRequirementsForm: React.FC<TripRequirementsFormProps> = ({ args, respond }) => {
  let parsedArgs = args;
  if (typeof args === "string") {
    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      parsedArgs = {};
    }
  }

  const [city, setCity] = useState("");
  const [numberOfDays, setNumberOfDays] = useState(3);
  const [numberOfPeople, setNumberOfPeople] = useState(2);
  const [budgetLevel, setBudgetLevel] = useState("Comfort");
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Pre-fill form from orchestrator extraction
  useEffect(() => {
    if (parsedArgs && parsedArgs.city && parsedArgs.city !== city) {
      setCity(parsedArgs.city);
    }
    if (parsedArgs && parsedArgs.numberOfDays && parsedArgs.numberOfDays !== numberOfDays) {
      setNumberOfDays(parsedArgs.numberOfDays);
    }
    if (parsedArgs && parsedArgs.numberOfPeople && parsedArgs.numberOfPeople !== numberOfPeople) {
      setNumberOfPeople(parsedArgs.numberOfPeople);
    }
    if (parsedArgs && parsedArgs.budgetLevel && parsedArgs.budgetLevel !== budgetLevel) {
      setBudgetLevel(parsedArgs.budgetLevel);
    }
  }, [parsedArgs?.city, parsedArgs?.numberOfDays, parsedArgs?.numberOfPeople, parsedArgs?.budgetLevel]);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!city.trim()) {
      newErrors.city = "Please enter a destination city";
    }

    if (numberOfDays < 1 || numberOfDays > 7) {
      newErrors.numberOfDays = "Number of days must be between 1 and 7";
    }

    if (numberOfPeople < 1 || numberOfPeople > 15) {
      newErrors.numberOfPeople = "Number of people must be between 1 and 15";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) {
      return;
    }

    setSubmitted(true);
    respond?.({
      city: city.trim(),
      numberOfDays,
      numberOfPeople,
      budgetLevel,
    });
  };

  if (submitted) {
    return (
      <div className="bg-[#85E0CE]/30 backdrop-blur-md border-2 border-[#85E0CE] rounded-lg p-4 my-3 shadow-elevation-md">
        <div className="flex items-center gap-2">
          <div className="text-2xl">✓</div>
          <div>
            <h3 className="text-base font-semibold text-[#010507]">Trip Requirements Submitted</h3>
            <p className="text-xs text-[#57575B]">
              Planning your {numberOfDays}-day trip to {city} for {numberOfPeople} people with{" "}
              {budgetLevel} budget...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#BEC2FF]/30 backdrop-blur-md border-2 border-[#BEC2FF] rounded-lg p-4 my-3 shadow-elevation-md">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-2xl">✈️</div>
        <div>
          <h3 className="text-base font-semibold text-[#010507]">Trip Planning Details</h3>
          <p className="text-xs text-[#57575B]">Please provide some information about your trip</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-[#010507] mb-1.5">
            Destination City *
          </label>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g., Paris, Tokyo, New York"
            className={`w-full px-3 py-2 text-sm rounded-lg border-2 transition-colors ${
              errors.city
                ? "border-[#FFAC4D] bg-[#FFAC4D]/10"
                : "border-[#DBDBE5] bg-white/80 backdrop-blur-sm focus:border-[#BEC2FF] focus:outline-none"
            }`}
          />
          {errors.city && <p className="text-xs text-[#FFAC4D] mt-1">{errors.city}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#010507] mb-1.5">
              Days (1-7) *
            </label>
            <div className="flex items-center gap-2 bg-white/80 backdrop-blur-sm border-2 border-[#DBDBE5] rounded-lg px-3 py-2.5">
              <div className="flex-1 px-1">
                <input
                  type="range"
                  min="1"
                  max="7"
                  value={numberOfDays}
                  onChange={(e) => setNumberOfDays(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-[#E9E9EF] rounded-lg appearance-none cursor-pointer"
                  style={{
                    WebkitAppearance: 'none',
                    background: `linear-gradient(to right, #BEC2FF 0%, #BEC2FF ${((numberOfDays - 1) / 6) * 100}%, #E9E9EF ${((numberOfDays - 1) / 6) * 100}%, #E9E9EF 100%)`
                  }}
                />
              </div>
              <span className="text-lg font-bold text-[#010507] min-w-[24px] text-center">{numberOfDays}</span>
            </div>
            {errors.numberOfDays && (
              <p className="text-xs text-[#FFAC4D] mt-1">{errors.numberOfDays}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-[#010507] mb-1.5">
              People (1-15) *
            </label>
            <div className="flex items-center gap-2 bg-white/80 backdrop-blur-sm border-2 border-[#DBDBE5] rounded-lg px-3 py-2.5">
              <div className="flex-1 px-1">
                <input
                  type="range"
                  min="1"
                  max="15"
                  value={numberOfPeople}
                  onChange={(e) => setNumberOfPeople(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-[#E9E9EF] rounded-lg appearance-none cursor-pointer"
                  style={{
                    WebkitAppearance: 'none',
                    background: `linear-gradient(to right, #85E0CE 0%, #85E0CE ${((numberOfPeople - 1) / 14) * 100}%, #E9E9EF ${((numberOfPeople - 1) / 14) * 100}%, #E9E9EF 100%)`
                  }}
                />
              </div>
              <span className="text-lg font-bold text-[#010507] min-w-[24px] text-center">{numberOfPeople}</span>
            </div>
            {errors.numberOfPeople && (
              <p className="text-xs text-[#FFAC4D] mt-1">{errors.numberOfPeople}</p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#010507] mb-1.5">Budget Level *</label>
          <div className="grid grid-cols-3 gap-2">
            {["Economy", "Comfort", "Premium"].map((level) => (
              <button
                key={level}
                onClick={() => setBudgetLevel(level)}
                className={`py-2 px-3 rounded-lg font-medium text-xs transition-all shadow-elevation-sm ${
                  budgetLevel === level
                    ? "bg-[#BEC2FF] text-white shadow-elevation-md scale-105"
                    : "bg-white/80 backdrop-blur-sm text-[#010507] border-2 border-[#DBDBE5] hover:border-[#BEC2FF]"
                }`}
              >
                <div className="text-base mb-0.5">
                  {level === "Economy" && "💰"}
                  {level === "Comfort" && "✨"}
                  {level === "Premium" && "👑"}
                </div>
                <div>{level}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <button
          onClick={handleSubmit}
          className="w-full bg-[#1B936F] hover:bg-[#189370] text-white font-semibold py-2.5 px-4 text-sm rounded-lg transition-all shadow-elevation-md hover:shadow-elevation-lg"
        >
          Start Planning My Trip
        </button>
      </div>
    </div>
  );
};
