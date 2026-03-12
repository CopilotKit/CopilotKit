'use client'

import { createContext, useContext, useState, ReactNode, useEffect } from 'react'
import type { ResearchState } from '@/lib/types'
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
    const [state, setState] = useState<ResearchState>({} as ResearchState)
    // @ts-expect-error -- force null
    const [localStorageState, setLocalStorageState] = useLocalStorage<ResearchState>('research', null);

    useEffect(() => {
        const localStorageStateEmpty = localStorageState == null || Object.keys(localStorageState).length < 1
        if (!localStorageStateEmpty && !state) {
            setState(localStorageState)
            return;
        }
        if (!state && localStorageStateEmpty) {
            setLocalStorageState(state)
            return;
        }
        if (!localStorageStateEmpty && !state && JSON.stringify(localStorageState) !== JSON.stringify(state)) {
            setLocalStorageState(state)
            return;
        }
    }, [state, localStorageState, setLocalStorageState]);

    return (
        <ResearchContext.Provider value={{ state, setResearchState: setState as ResearchContextType['setResearchState'], setSourcesModalOpen, sourcesModalOpen, runAgent: () => {} }}>
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