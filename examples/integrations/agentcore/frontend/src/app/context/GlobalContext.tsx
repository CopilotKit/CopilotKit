"use client";
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Global context provider for the application
 * Provides shared state and functionality across components
 */

import { createContext, useContext, PropsWithChildren, useState } from "react";

interface GlobalContextType {
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

const GlobalContext = createContext<GlobalContextType | undefined>(undefined);

/**
 * Hook to access the global context
 * @returns The global context value
 * @throws Error if used outside of GlobalContextProvider
 */
export function useGlobal(): GlobalContextType {
  const context = useContext(GlobalContext);
  if (context === undefined) {
    throw new Error("useGlobal must be used within a GlobalContextProvider");
  }
  return context;
}

/**
 * Global context provider component
 * Wraps the application to provide global state
 * @param children - Child components to wrap
 */
export function GlobalContextProvider({ children }: PropsWithChildren) {
  const [isLoading, setIsLoading] = useState(false);

  const value: GlobalContextType = {
    isLoading,
    setIsLoading,
  };

  return (
    <GlobalContext.Provider value={value}>{children}</GlobalContext.Provider>
  );
}
