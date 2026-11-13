"use client"

import { useContext, useState } from "react"
import { User, ChevronDown, LogOut } from 'lucide-react'

import { AuthContext } from "./fake-auth-provider"

import { FAKE_USERS } from "@/lib/users"

// Native <select> with the browser arrow replaced by our own icon, so the
// arrow has consistent padding and doesn't sit on the border.
const UserSelect = ({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <div className="relative">
        <select
            {...props}
            className={`w-full appearance-none text-sm border border-gray-300 rounded-lg pl-3 pr-9 py-2 bg-white hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors cursor-pointer ${className}`}
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
    </div>
)

export const UserMenu = () => {
    const authContext = useContext(AuthContext)
    const [isExpanded, setIsExpanded] = useState(false)

    if (!authContext) {
        throw new Error("AuthContext is not available")
    }

    const { user, login, logout } = authContext

    const handleLogin = (userId: string) => {
        login(userId)
        setIsExpanded(false)
    }

    const handleLogout = () => {
        logout()
        setIsExpanded(false)
    }

    const handleToggle = () => {
        setIsExpanded(!isExpanded)
    }

    return (
        <div className="fixed top-4 left-4 z-50 w-64">
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden transition-all duration-200">
                {user ? (
                    <>
                        <button
                            onClick={handleToggle}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors w-full text-left"
                            aria-label="Toggle user menu"
                            aria-expanded={isExpanded}
                        >
                            <div className="shrink-0 w-8 h-8 rounded-full bg-linear-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white">
                                <User className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-gray-900 truncate">{user.name}</div>
                                <div className="text-xs text-gray-500 truncate">{user.email}</div>
                            </div>
                            <div className={`shrink-0 text-gray-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}>
                                <ChevronDown className="w-4 h-4" />
                            </div>
                        </button>
                        {isExpanded && (
                            <div className="border-t border-gray-200 px-4 py-3 space-y-3 bg-gray-50/50">
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-gray-500">Role:</span>
                                    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-medium capitalize">
                                        {user.role}
                                    </span>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-gray-700 block">Switch User</label>
                                    <UserSelect
                                        onChange={(e) => handleLogin(e.target.value)}
                                        value={user.id}
                                        className="text-indigo-700 font-medium"
                                    >
                                        {FAKE_USERS.map((u) => (
                                            <option key={u.id} value={u.id}>
                                                {u.name} ({u.role})
                                            </option>
                                        ))}
                                    </UserSelect>
                                </div>
                                <button
                                    onClick={handleLogout}
                                    className="w-full flex items-center justify-center gap-2 text-sm bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors font-medium"
                                >
                                    <LogOut className="w-4 h-4" />
                                    Logout
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="px-4 py-3 space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500">
                                <User className="w-5 h-5" />
                            </div>
                            <div className="text-sm font-semibold text-gray-700">Not logged in</div>
                        </div>
                        <UserSelect
                            onChange={(e) => handleLogin(e.target.value)}
                            className="text-gray-700"
                            defaultValue=""
                        >
                            <option value="" disabled>Select user...</option>
                            {FAKE_USERS.map((u) => (
                                <option key={u.id} value={u.id}>
                                    {u.name} ({u.role})
                                </option>
                            ))}
                        </UserSelect>
                    </div>
                )}
            </div>
        </div>
    )
}
