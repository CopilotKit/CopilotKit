import { data } from "../../../data";
import { NextRequest } from "next/server";

const getCardById = (id: string) => {
    const card = data.cards.find(card => card.id === id);
    if (!card) {
        return null
    }
    return card;
}

// Get policy per card
export const GET = async (req: NextRequest, { params }: { params: { id: string } }) => {
    const card = getCardById(params.id);
    if (!card) {
        return new Response(JSON.stringify({ error: 'Card not found' }), { status: 404 });
    }
    const policy = data.policies.find(policy => policy.id === card.expensePolicyId);
    return new Response(JSON.stringify(policy), { status: 200 });
};

// Assign policy
export const POST = async (req: NextRequest, { params }: { params: { id: string } }) => {
    try {
        const card = getCardById(params.id);
        if (!card) {
            return new Response(JSON.stringify({ error: 'Card not found' }), { status: 404 });
        }
        // Handle new card creation
        const body = await req.json();
        const { policyId } = body;
        const newCard = { ...card, expensePolicyId: policyId }
        data.cards = data.cards.map(card => {
            if (card.id === params.id) {
                return newCard;
            }
            return card;
        });
        return new Response(JSON.stringify(newCard), { status: 201 });
    } catch (error) {
        console.error('POST Request error', error);
    }
};
