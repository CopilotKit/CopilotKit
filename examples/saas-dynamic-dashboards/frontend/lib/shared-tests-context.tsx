"use client"

import { createContext, useContext, useState, ReactNode } from 'react'
import { TestsData } from '@/app/Interfaces/interface'
type SharedContextType = {
    testsData: TestsData[]
    setTestsData: (data: TestsData[]) => void
}

const SharedContext = createContext<SharedContextType | undefined>(undefined)

export function SharedTestsProvider({ children }: { children: ReactNode }) {
    const [testsData, setTestsData] = useState<TestsData[]>([])

    return (
        <SharedContext.Provider value={{ testsData, setTestsData }}>
            {children}
        </SharedContext.Provider>
    )
}

export function useSharedTestsContext() {
    const context = useContext(SharedContext)
    if (context === undefined) {
        throw new Error('useSharedTestsContext must be used within a SharedProvider')
    }
    return context
} 