"use client"

import { useState, ReactNode, createContext, useMemo, useEffect, startTransition } from "react"
import { CopilotKit } from "@copilotkit/react-core/v2"
import { FakeUser } from "@/lib/users"
import { getInitialUser, login as loginUser, logout as logoutUser, generateToken } from "@/lib/auth"

type AuthContextType = {
    user: FakeUser | null
    login: (userId: string) => void
    logout: () => void
    token: string | null
}

export const AuthContext = createContext<AuthContextType | null>(null)

export const FakeAuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<FakeUser | null>(null)

    useEffect(() => {
        // Initialize user from localStorage after hydration to avoid SSR mismatch
        const initialUser = getInitialUser()
        if (initialUser) {
            startTransition(() => {
                setUser(initialUser)
            })
        }
    }, [])

    const token = useMemo(() => generateToken(user), [user])

    const handleLogin = (userId: string) => {
        const loggedInUser = loginUser(userId)
        if (loggedInUser) {
            setUser(loggedInUser)
        }
    }

    const handleLogout = () => {
        logoutUser()
        setUser(null)
    }

    // `properties` are sent to the agent as AG-UI `forwardedProps` on every run.
    // The Python agent reads `authorization` from there (see backend/agent.py).
    const properties = useMemo(() => ({ authorization: token }), [token])

    return (
        <AuthContext.Provider value={{ user, login: handleLogin, logout: handleLogout, token }}>
            <CopilotKit
                runtimeUrl="/api/copilotkit"
                agentId="agent_with_auth"
                useSingleEndpoint={false}
                // Hide the CopilotKit dev inspector overlay; set to true to debug agent events.
                enableInspector={false}
                properties={properties}
            >
                {children}
            </CopilotKit>
        </AuthContext.Provider>
    )
}

