"use client";
// import { AvailableAgents } from "@/lib/available-agents";

/**
 * Base Agent State
 */


/**
 * Travel Agent Types
 */
export type Place = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  rating: number;
  description?: string;
};

export type Trip = {
  id: string;
  name: string;
  center_latitude: number;
  center_longitude: number;
  zoom_level?: number | 13;
  places: Place[];
};

export type SearchProgress = {
  query: string;
  done: boolean;
};


/**
 * Research Agent Types
 */
export interface Section {
  title: string;
  content: string;
  idx: number;
  footer?: string;
  id: string;
}

export interface Source {
  content: string;
  published_date: string;
  score: number;
  title: string;
  url: string;
}
export type Sources = Record<string, Source>;

export interface Log {
  message: string;
  done: boolean;
}

/**
 * This provider wraps state from all agents
 */
export const CoAgentsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {



  return (
    <>
      {children}
    </>
  );
};

