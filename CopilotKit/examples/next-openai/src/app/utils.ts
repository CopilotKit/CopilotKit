"use client";
export function generateRandomString(length: number) {
  let result = "";
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

import { useState, useEffect } from "react";

export function useStateWithLocalStorage(defaultValue, key) {
  const [state, setState] = useState(() => {
    if (typeof window !== "undefined") {
      const storagedValue = localStorage.getItem(key);
      if (storagedValue) {
        return JSON.parse(storagedValue);
      }
    }
    return defaultValue;
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(key, JSON.stringify(state));
    }
  }, [key, state]);

  return [state, setState];
}
