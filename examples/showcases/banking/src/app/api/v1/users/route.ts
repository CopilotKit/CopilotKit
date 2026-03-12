import { NextRequest } from "next/server";
import { data, generateUniqueId } from "../data";

export const GET = async () => {
    return new Response(JSON.stringify(data.team), { status: 200 });
};

export const POST = async (req: NextRequest) => {
    try {
        // Handle new item creation
        const body = await req.json();
        const { name, email, role, team } = body;
        const newUser = { id: generateUniqueId(), name, email, role, team }
        data.team.push(newUser);
        return new Response(JSON.stringify(newUser), { status: 201 });
    } catch (error) {
        console.error('POST Request error', error);
    }
};
