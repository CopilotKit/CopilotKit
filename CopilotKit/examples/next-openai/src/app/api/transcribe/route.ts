import { OpenAI } from "openai";

export const runtime = "edge";

const openai = new OpenAI();

export async function POST(req: Request): Promise<Response> {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return new Response("File not provided", { status: 400 });
    }

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });

    return new Response(JSON.stringify(transcription), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
