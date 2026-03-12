import { NextRequest } from "next/server";
import { Card, data, generateUniqueId } from "../data";

export const GET = async () => {
    return new Response(JSON.stringify(data.cards), { status: 200 });
};

export const POST = async (req: NextRequest) => {
    try {
        // Handle new card creation
        const body = await req.json();
        const { last4, expiry, type, color, pin } = body;
        const newCard: Card = { id: generateUniqueId(), last4, expiry, type, color, pin, expensePolicyId: "8r5c3m4n5o" }; // Ensure all required fields are included
        // Assuming there's a function to add a new card to the data
        data.cards.push(newCard);
        return new Response(JSON.stringify(newCard), { status: 201 });
    } catch (error) {
        console.error('POST Request error', error);
    }
};
