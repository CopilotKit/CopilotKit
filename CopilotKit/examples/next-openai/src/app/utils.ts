"use client";
export function generateRandomString(length: number) {
  let result = "";
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

import { useState, useEffect, useRef } from "react";

export function useStateWithLocalStorage(
  defaultValue: string,
  key: string,
): [string, React.Dispatch<React.SetStateAction<string>>] {
  const [state, setState] = useState<string>(defaultValue);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const storagedValue = localStorage.getItem(key);
      if (storagedValue) {
        try {
          setState(JSON.parse(storagedValue));
        } catch {}
      }
    }
  }, [key]);

  useEffect(() => {
    if (typeof window !== "undefined" && !isFirstRender.current) {
      localStorage.setItem(key, JSON.stringify(state));
    }
    if (isFirstRender.current) {
      isFirstRender.current = false;
    }
  }, [key, state]);

  return [state, setState];
}
