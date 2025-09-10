"use client";

import React, { useState, useEffect } from "react";
import { useGlobalContext } from "@/context/GlobalContext";

export const LocationForm = ({
  onSubmit,
}: {
  onSubmit: (city: string) => void;
}) => {
  const { location, setLocation } = useGlobalContext();
  const [formData, setFormData] = useState({
    city: location.city || "",
  });

  // Keep our form state in sync with global context
  useEffect(() => {
    if (location.city !== formData.city && location.city) {
      setFormData((prev) => ({
        ...prev,
        city: location.city || "",
      }));
    }
  }, [location.city, formData.city]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    // Update the global context immediately on change
    if (name === "city") {
      setLocation({ ...location, city: value });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Make sure location is updated
    setLocation({ ...location, city: formData.city });
    onSubmit(formData.city);
  };

  return (
    <div className="bg-white rounded-md border border-gray-200 p-4 mb-4">
      <h2 className="text-sm font-medium text-gray-700 mb-3 capitalize">
        Find restaurants in
      </h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <input
            type="text"
            id="city"
            name="city"
            value={formData.city}
            onChange={handleChange}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-gray-500 focus:border-gray-500 sm:text-sm"
            placeholder="Enter city"
          />
        </div>
        <div>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none"
          >
            Find
          </button>
        </div>
      </form>
    </div>
  );
};
