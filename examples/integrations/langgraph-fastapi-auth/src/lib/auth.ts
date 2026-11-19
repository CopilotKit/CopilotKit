import { FAKE_USERS, FakeUser } from "./users"

// Helper to get initial user from localStorage
export const getInitialUser = (): FakeUser | null => {
    if (typeof window === "undefined") {
        return null
    }

    const savedUserId = localStorage.getItem("fake_user_id")
    if (savedUserId) {
        const user = FAKE_USERS.find((u) => u.id === savedUserId)
        if (user) {
            return user
        }
    }
    return null
}

export const login = (userId: string): FakeUser | null => {
    const user = FAKE_USERS.find((u) => u.id === userId)
    if (user) {
        localStorage.setItem("fake_user_id", userId)
        return user
    }
    return null
}

export const logout = () => {
    localStorage.removeItem("fake_user_id")
}

// Generate a fake token for the current user
// In production, this would be a real JWT or session token from your auth system
export const generateToken = (currentUser: FakeUser | null): string | null => {
    if (!currentUser) {
        return null
    }

    const base64UrlEncode = (str: string) => {
        if (typeof window === "undefined") {
            return ""
        }
        return btoa(str)
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=/g, "")
    }

    const header = {
        alg: "HS256",
        typ: "JWT",
    }

    const payload = {
        user_id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        role: currentUser.role,
    }

    const encodedHeader = base64UrlEncode(JSON.stringify(header))
    const encodedPayload = base64UrlEncode(JSON.stringify(payload))

    // In a real app, you'd create a signature and encode it here
    const signature = "fake-signature"

    return `${encodedHeader}.${encodedPayload}.${signature}`
}
