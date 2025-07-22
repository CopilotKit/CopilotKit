"use client"

import { createContext, useContext, useState, ReactNode } from 'react'
import { PRData } from '@/app/Interfaces/interface'
type SharedContextType = {
    prData: PRData[]
    setPrData: (data: PRData[]) => void
}

const SharedContext = createContext<SharedContextType | undefined>(undefined)

export function SharedProvider({ children }: { children: ReactNode }) {
    const [prData, setPrData] = useState<PRData[]>([])

    return (
        <SharedContext.Provider value={{ prData, setPrData }}>
            {children}
        </SharedContext.Provider>
    )
}

export function useSharedContext() {
    const context = useContext(SharedContext)
    if (context === undefined) {
        throw new Error('useSharedContext must be used within a SharedProvider')
    }
    return context
} 