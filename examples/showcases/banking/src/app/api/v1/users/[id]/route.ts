import { NextRequest } from "next/server";
import { data } from "../../data";

export const PUT = async (req: NextRequest, { params }: { params: { id: string } }) => {
    try {
        // Handle pin or card limit change
        const body = await req.json();
        const { team, role } = body;
        const index = data.team.findIndex(user => user.id === params.id);
        if (index !== -1) {
            data.team[index] = {
                ...data.team[index],
                team: team ?? data.team[index].team,
                role: role ?? data.team[index].role
            };
            return new Response(JSON.stringify(data.team[index]), { status: 200 });
        } else {
            return new Response(JSON.stringify({ error: 'Card not found' }), { status: 404 });
        }
    } catch (error) {
        console.error('PUT Request error', error);
    }
};

export const DELETE = async (req: NextRequest, { params }: { params: { id: string } }) => {
    try {
        const index = data.team.findIndex(user => user.id === params.id);
        if (index !== -1) {
            data.team.splice(index, 1);
            return new Response(JSON.stringify(data.team), { status: 200 });
        } else {
            return new Response(JSON.stringify({ error: 'Card not found' }), { status: 404 });
        }
    } catch (error) {
        console.error('DELETE Request error', error);
    }
};
