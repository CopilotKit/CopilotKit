// Fake user data for testing
export const FAKE_USERS = [
    {
        id: "user-1",
        name: "John Doe",
        email: "john.doe@example.com",
        role: "admin",
    },
    {
        id: "user-2",
        name: "Jane Smith",
        email: "jane.smith@example.com",
        role: "user",
    },
    {
        id: "user-3",
        name: "Bob Johnson",
        email: "bob.johnson@example.com",
        role: "user",
    },
]

export type FakeUser = {
    id: string
    name: string
    email: string
    role: string
}
