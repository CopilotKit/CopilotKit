"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";

type Location = {
  city?: string;
  country?: string;
  timezone?: string;
};

interface GlobalContextType {
  location: Location;
  setLocation: (location: Location) => void;
  initialMessageSent: boolean;
  setInitialMessageSent: (initialMessageSent: boolean) => void;
}

const initialContext: GlobalContextType = {
  location: {},
  setLocation: () => {},
  initialMessageSent: false,
  setInitialMessageSent: () => {},
};

const GlobalContext = createContext<GlobalContextType>(initialContext);

export const useGlobalContext = () => useContext(GlobalContext);

export const GlobalContextProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [location, setLocation] = useState<Location>({});
  const [initialMessageSent, setInitialMessageSent] = useState(false);

  return (
    <GlobalContext.Provider
      value={{
        location,
        setLocation,
        initialMessageSent,
        setInitialMessageSent,
      }}
    >
      {children}
    </GlobalContext.Provider>
  );
};
