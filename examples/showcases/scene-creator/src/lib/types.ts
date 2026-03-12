// Types for scene generation artifacts

export interface Character {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  prompt?: string;
}

export interface Background {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  prompt?: string;
}

export interface Scene {
  id: string;
  name: string;
  description: string;
  characterIds: string[];
  backgroundId: string;
  imageUrl?: string;
  prompt?: string;
}

// Agent state matching Python AgentState
export interface AgentState {
  characters: Character[];
  backgrounds: Background[];
  scenes: Scene[];
  apiKey?: string;  // Dynamic API key from frontend
}
