import { NextRequest } from "next/server";
import { data } from "../../data";

export const PUT = async (req: NextRequest, { params }: { params: { id: string } }) => {
    try {
        const cardId = params.id
        // Handle pin or card limit change
        const body = await req.json();
        console.info(`${req.method}: ${req.url} called with: ${JSON.stringify(body)}`);
        const { pin } = body;
        const cardIndex = data.cards.findIndex(card => card.id === cardId);
        if (cardIndex !== -1) {
            if (pin) {
                data.cards[cardIndex].pin = pin;
            }
            return new Response(JSON.stringify(data.cards[cardIndex]), { status: 200 });
        } else {
            return new Response(JSON.stringify({ error: 'Card not found' }), { status: 404 });
        }
    } catch (error) {
        console.error('PUT Request error', error);
    }
};
