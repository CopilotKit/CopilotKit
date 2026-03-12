'use client'

import { createContext, useContext, useState, ReactNode, useEffect } from 'react'
import type { ResearchState } from '@/lib/types'
import { useCoAgent } from "@copilotkit/react-core";
import useLocalStorage from "@/lib/hooks/useLocalStorage";

interface ResearchContextType {
    state: ResearchState;
    setResearchState: (newState: ResearchState | ((prevState: ResearchState) => ResearchState)) => void
    sourcesModalOpen: boolean
    setSourcesModalOpen: (open: boolean) => void
    runAgent: () => void
}

const ResearchContext = createContext<ResearchContextType | undefined>(undefined)

export function ResearchProvider({ children }: { children: ReactNode }) {
    const [sourcesModalOpen, setSourcesModalOpen] = useState<boolean>(false)
    const { state: coAgentState, setState: setCoAgentsState, run } = useCoAgent<ResearchState>({
        name: 'agent',
        initialState: {},
    });
    // @ts-expect-error -- force null
    const [localStorageState, setLocalStorageState] = useLocalStorage<ResearchState>('research', null);

    useEffect(() => {
        const coAgentsStateEmpty = Object.keys(coAgentState).length < 1
        const localStorageStateEmpty = localStorageState == null || Object.keys(localStorageState).length < 1
        if (!localStorageStateEmpty && coAgentsStateEmpty) {
            setCoAgentsState(localStorageState)
            return;
        }
        if (!coAgentsStateEmpty && localStorageStateEmpty) {
            setLocalStorageState(coAgentState)
            return;
        }
        if (!localStorageStateEmpty && !coAgentsStateEmpty && JSON.stringify(localStorageState) !== JSON.stringify(coAgentState)) {
            setLocalStorageState(coAgentState)
            return;
        }
    }, [coAgentState, localStorageState, setCoAgentsState, setLocalStorageState]);

    return (
        <ResearchContext.Provider value={{ state: coAgentState, setResearchState: setCoAgentsState as ResearchContextType['setResearchState'], setSourcesModalOpen, sourcesModalOpen, runAgent: run }}>
            {children}
        </ResearchContext.Provider>
    )
}

export function useResearch() {
    const context = useContext(ResearchContext)
    if (context === undefined) {
        throw new Error('useResearch must be used within a ResearchProvider')
    }
    return context
}