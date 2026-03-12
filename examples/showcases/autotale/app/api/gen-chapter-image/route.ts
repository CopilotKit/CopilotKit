import { NextRequest, NextResponse } from "next/server";
import OpenAI from "OpenAI";

const openai = new OpenAI();

export async function POST(req: NextRequest, res: NextResponse) {
  const { description } = await req.json();

  // console.log('Generating image', description)

  const result = await openai.images.generate({
    model: "dall-e-3",
    prompt: description.slice(0, 900),
    size: "1024x1024",
  });

  // console.log('result', result)

  if (!result.data[0]?.url) {
    return NextResponse.json({
      imageUrl: "https://placehold.co/400?text=ERROR_GENERATING_IMAGE",
    });
  }

  return NextResponse.json({ imageUrl: result.data[0].url });
}
